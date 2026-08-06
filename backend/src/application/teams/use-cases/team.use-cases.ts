import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { CounterService } from '@module-shared/services/counter.service';
import { uniqueSlug } from '@module-shared/utils/slug.util';
import {
  CreateTeamDto,
  UpdateTeamDto,
  UpdateTeamLabelsDto,
  UpdateTeamCustomFieldsDto,
  UpdateTeamStatusesDto,
} from '../dtos/team.dtos';
import { TeamEntity } from '../domain/entities/team.entity';
import { DEFAULT_TEAMS } from '../domain/enums/team.enums';
import { deriveRefPrefix } from '../domain/team-ref-prefix';
import { ITeamRepository } from '../repositories/team.repository';

/**
 * Guarantees a workspace has its two default teams (QC · Engineering). Called
 * on registration and by the boot backfill for workspaces that predate teams.
 * Idempotent: only creates what's missing.
 */
@Injectable()
export class EnsureDefaultTeamsUseCase
  implements IUsecaseExecute<{ tenantId: string }, Result<TeamEntity[]>>
{
  constructor(@Inject(ITeamRepository) private readonly teams: ITeamRepository) {}

  async execute({ tenantId }: { tenantId: string }): Promise<Result<TeamEntity[]>> {
    const created: TeamEntity[] = [];
    for (const [i, def] of DEFAULT_TEAMS.entries()) {
      const existing = await this.teams.findByKey(tenantId, def.key);
      if (existing) continue;
      const result = TeamEntity.create({
        tenantId,
        key: def.key,
        name: def.name,
        issueType: def.issueType,
        order: i,
        refPrefix: def.refPrefix,
      });
      if (result.isFailure) return Result.fail(result.error as string);
      const team = result.getValue();
      await this.teams.save(team);
      created.push(team);
    }
    return Result.ok(created);
  }
}

@Injectable()
export class GetTeamsUseCase
  implements IUsecaseExecute<{ tenantId: string }, Result<TeamEntity[]>>
{
  constructor(@Inject(ITeamRepository) private readonly teams: ITeamRepository) {}

  async execute({ tenantId }: { tenantId: string }): Promise<Result<TeamEntity[]>> {
    return Result.ok(await this.teams.findByTenant(tenantId));
  }
}

@Injectable()
export class CreateTeamUseCase
  implements IUsecaseExecute<{ tenantId: string; dto: CreateTeamDto }, Result<TeamEntity>>
{
  constructor(@Inject(ITeamRepository) private readonly teams: ITeamRepository) {}

  async execute({
    tenantId,
    dto,
  }: {
    tenantId: string;
    dto: CreateTeamDto;
  }): Promise<Result<TeamEntity>> {
    // Both the key and the ref prefix are derived by *reading* the tenant's
    // current teams and then writing — a read-then-write that two simultaneous
    // creates can interleave, so both derive the same value and the second save
    // hits the unique index. The index is the real guard; this loop is how a
    // genuine race is absorbed instead of surfacing as a 500: on a duplicate-key
    // error, re-read and re-derive against the row the winner just wrote.
    for (let attempt = 0; attempt < CREATE_TEAM_ATTEMPTS; attempt++) {
      // Key is derived from the name, then de-duplicated — it's the stable id.
      const key = await uniqueSlug(dto.name, async (c) =>
        !!(await this.teams.findByKey(tenantId, c)),
      );

      const existing = await this.teams.findByTenant(tenantId);
      // Archived teams are in this list, and that is deliberate: a prefix is never
      // released, so refs minted under it can never be minted a second time.
      const takenPrefixes = new Set(
        existing.map((t) => t.refPrefix).filter((p): p is string => !!p),
      );
      const result = TeamEntity.create({
        tenantId,
        key,
        name: dto.name,
        issueType: dto.issueType,
        icon: dto.icon,
        color: dto.color,
        order: existing.length,
        refPrefix: deriveRefPrefix(dto.name, takenPrefixes),
      });
      if (result.isFailure) return Result.fail(result.error as string);
      const team = result.getValue();
      try {
        await this.teams.save(team);
        return Result.ok(team);
      } catch (error) {
        // Anything that is not the index rejecting a duplicate is a real
        // failure and must not be retried.
        if (!isDuplicateKeyError(error)) throw error;
        // Out of attempts: the raw E11000 would leave the controller with an
        // unmapped throw and the client with a 500. A lost race is a domain
        // outcome, so it leaves as one.
        if (attempt === CREATE_TEAM_ATTEMPTS - 1) return Result.fail(TEAM_CREATE_RACE_LOST);
      }
    }
    /* istanbul ignore next — the loop either returns or throws. */
    return Result.fail(TEAM_CREATE_RACE_LOST);
  }
}

/** Attempts including the first; a second racer only has to lose once. */
const CREATE_TEAM_ATTEMPTS = 3;

/** Sentinel for the unreachable "ran out of attempts without throwing" branch. */
export const TEAM_CREATE_RACE_LOST = 'Could not create the team, please try again';

/**
 * Mongo's duplicate-key rejection (`E11000`), however the driver surfaced it —
 * as a `MongoServerError` with `code`, or wrapped by Mongoose with the code on
 * `cause`.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; cause?: unknown; message?: unknown };
  if (e.code === 11000) return true;
  if (typeof e.message === 'string' && e.message.includes('E11000')) return true;
  return e.cause ? isDuplicateKeyError(e.cause) : false;
}

/** Sentinel so the controller can map "can't archive a default team" to 400. */
export const TEAM_DEFAULT_LOCKED = 'The default teams cannot be archived';

/** Sentinel so the controller can tell a missing team from a rejected write. */
export const TEAM_NOT_FOUND = 'Team not found';

/** Sentinel so the controller can map an after-the-fact prefix change to 400. */
export const TEAM_PREFIX_FROZEN =
  'This team has already issued tickets, so its prefix can no longer be changed';

/** Sentinel so the controller can map a duplicate prefix to 400. */
export const TEAM_PREFIX_TAKEN = 'Another team already uses that prefix';

/**
 * The single definition of "is this team's prefix locked?".
 *
 * It lives here rather than in `TeamMapper` because the answer is not on the
 * entity: it is the tenant's counter for that prefix, which only an async
 * use-case can read. `many` issues the lookups as a single `Promise.all` so the
 * team list stays one round-trip per team rather than a serial chain.
 *
 * `UpdateTeamUseCase` enforces the freeze through this same method rather than
 * reading the counter itself. That is deliberate: the flag the UI disables its
 * input from and the check the API rejects a write with must be one expression,
 * or they drift and the UI starts offering edits the API refuses.
 */
@Injectable()
export class ResolveTeamPrefixLockUseCase {
  constructor(private readonly counters: CounterService) {}

  async one(tenantId: string, team: TeamEntity): Promise<boolean> {
    // A team with no prefix has never minted anything, so there is nothing to
    // freeze — and asking the counter would query the meaningless key
    // `"<tenantId>:"`. Short-circuit before touching the store.
    if (!team.refPrefix) return false;
    return (await this.counters.current(tenantId, team.refPrefix)) > 0;
  }

  async many(tenantId: string, teams: TeamEntity[]): Promise<boolean[]> {
    return Promise.all(teams.map((t) => this.one(tenantId, t)));
  }
}

@Injectable()
export class UpdateTeamUseCase
  implements
    IUsecaseExecute<{ tenantId: string; id: string; dto: UpdateTeamDto }, Result<TeamEntity>>
{
  constructor(
    @Inject(ITeamRepository) private readonly teams: ITeamRepository,
    private readonly prefixLock: ResolveTeamPrefixLockUseCase,
  ) {}

  async execute({
    tenantId,
    id,
    dto,
  }: {
    tenantId: string;
    id: string;
    dto: UpdateTeamDto;
  }): Promise<Result<TeamEntity>> {
    const team = await this.teams.findById(tenantId, id);
    if (!team) return Result.fail(TEAM_NOT_FOUND);

    if (dto.name !== undefined) {
      const renamed = team.rename(dto.name);
      if (renamed.isFailure) return Result.fail(renamed.error as string);
    }
    if (dto.icon !== undefined) {
      team.setIcon(dto.icon);
    }
    if (dto.color !== undefined) {
      team.setColor(dto.color);
    }
    if (dto.archived !== undefined) {
      const archived = team.setArchived(dto.archived);
      if (archived.isFailure) return Result.fail(archived.error as string);
    }
    // Whether *this* call moved the prefix — the only thing on this path that can
    // make the unique index reject the save, and so the only case in which a
    // duplicate-key error may be read as "that prefix is taken".
    let prefixChanged = false;
    if (dto.refPrefix !== undefined) {
      const wanted = dto.refPrefix.trim().toUpperCase();
      // Re-submitting the current prefix is a no-op, not a change. The settings
      // form PATCHes every field it renders, so a frozen team would otherwise be
      // unable to save a rename.
      if (wanted !== team.refPrefix) {
        // Frozen on the *counter*, not on issue count: deleting every issue in a
        // team must not free the numbers already printed in commits and comments.
        // Asked through the same `one()` the response DTO's `refPrefixLocked` is
        // built from, so the input the UI disables and the write the API refuses
        // can never disagree. (`one` already returns false for an empty prefix.)
        if (await this.prefixLock.one(tenantId, team)) {
          return Result.fail(TEAM_PREFIX_FROZEN);
        }
        const others = (await this.teams.findByTenant(tenantId)).filter(
          (t) => t.id.toString() !== id,
        );
        if (others.some((t) => t.refPrefix === wanted)) return Result.fail(TEAM_PREFIX_TAKEN);

        const set = team.setRefPrefix(wanted);
        if (set.isFailure) return Result.fail(set.error as string);
        prefixChanged = true;
      }
    }

    // The `others.some(...)` check above is a read-then-write: between it and this
    // save, `CreateTeamUseCase` can derive and commit the same prefix. The unique
    // partial index is the real guard, and its rejection arrives here as a raw
    // `MongoServerError` — which the controller, mapping only `Result.isFailure`,
    // would turn into a 500 rather than the 400 the settings form renders against
    // the field. Convert it to the same sentinel the pre-check returns.
    //
    // Unlike `CreateTeamUseCase` this does *not* retry: there the prefix is
    // derived, so re-deriving against the winner's row yields a different, free
    // one. Here the admin named the prefix, so a retry would re-attempt the same
    // taken value and fail identically. "Taken" is the honest answer.
    try {
      await this.teams.save(team);
    } catch (error) {
      if (prefixChanged && isDuplicateKeyError(error)) return Result.fail(TEAM_PREFIX_TAKEN);
      throw error;
    }
    return Result.ok(team);
  }
}


/** Replace a team's board columns. Built-ins are enforced by the entity. */
@Injectable()
export class UpdateTeamStatusesUseCase
  implements
    IUsecaseExecute<
      { tenantId: string; id: string; dto: UpdateTeamStatusesDto },
      Result<TeamEntity>
    >
{
  constructor(@Inject(ITeamRepository) private readonly teams: ITeamRepository) {}

  async execute({
    tenantId,
    id,
    dto,
  }: {
    tenantId: string;
    id: string;
    dto: UpdateTeamStatusesDto;
  }): Promise<Result<TeamEntity>> {
    const team = await this.teams.findById(tenantId, id);
    if (!team) return Result.fail(TEAM_NOT_FOUND);

    const set = team.setStatuses(dto.statuses);
    if (set.isFailure) return Result.fail(set.error as string);

    await this.teams.save(team);
    return Result.ok(team);
  }
}

/** Replace a team's item labels (shared by its tasks/bugs). Empty list clears them. */
@Injectable()
export class UpdateTeamLabelsUseCase
  implements
    IUsecaseExecute<
      { tenantId: string; id: string; dto: UpdateTeamLabelsDto },
      Result<TeamEntity>
    >
{
  constructor(@Inject(ITeamRepository) private readonly teams: ITeamRepository) {}

  async execute({
    tenantId,
    id,
    dto,
  }: {
    tenantId: string;
    id: string;
    dto: UpdateTeamLabelsDto;
  }): Promise<Result<TeamEntity>> {
    const team = await this.teams.findById(tenantId, id);
    if (!team) return Result.fail(TEAM_NOT_FOUND);

    const set = team.setLabels(dto.labels);
    if (set.isFailure) return Result.fail(set.error as string);

    await this.teams.save(team);
    return Result.ok(team);
  }
}

@Injectable()
export class UpdateTeamCustomFieldsUseCase
  implements
    IUsecaseExecute<
      { tenantId: string; id: string; dto: UpdateTeamCustomFieldsDto },
      Result<TeamEntity>
    >
{
  constructor(@Inject(ITeamRepository) private readonly teams: ITeamRepository) {}

  async execute({
    tenantId,
    id,
    dto,
  }: {
    tenantId: string;
    id: string;
    dto: UpdateTeamCustomFieldsDto;
  }): Promise<Result<TeamEntity>> {
    const team = await this.teams.findById(tenantId, id);
    if (!team) return Result.fail(TEAM_NOT_FOUND);

    const set = team.setCustomFields(dto.customFields);
    if (set.isFailure) return Result.fail(set.error as string);

    await this.teams.save(team);
    return Result.ok(team);
  }
}

/** Toggle a team board's public read-only link, minting a token when enabling. */
@Injectable()
export class SetTeamSharingUseCase
  implements
    IUsecaseExecute<{ tenantId: string; id: string; enabled: boolean }, Result<TeamEntity>>
{
  constructor(@Inject(ITeamRepository) private readonly teams: ITeamRepository) {}

  async execute({
    tenantId,
    id,
    enabled,
  }: {
    tenantId: string;
    id: string;
    enabled: boolean;
  }): Promise<Result<TeamEntity>> {
    const team = await this.teams.findById(tenantId, id);
    if (!team) return Result.fail(TEAM_NOT_FOUND);
    // Reuse the existing token when re-enabling so old links keep working.
    if (enabled) team.enableSharing(team.publicToken ?? uuid());
    else team.disableSharing();
    await this.teams.save(team);
    return Result.ok(team);
  }
}

/** Resolve a public share token into a read-only team (its board columns live on the team). */
@Injectable()
export class GetPublicTeamUseCase
  implements IUsecaseExecute<{ token: string }, Result<TeamEntity>>
{
  constructor(@Inject(ITeamRepository) private readonly teams: ITeamRepository) {}

  async execute({ token }: { token: string }): Promise<Result<TeamEntity>> {
    const team = await this.teams.findByPublicToken(token);
    if (!team) return Result.fail('This link is not available');
    return Result.ok(team);
  }
}
