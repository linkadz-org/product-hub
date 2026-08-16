import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { MintedRef, sequentialRef } from '@module-shared/utils/sequential-ref.util';
import { CounterService } from '@module-shared/services/counter.service';
import { ITeamRepository } from '@application/teams/repositories/team.repository';
import { DEFAULT_TEAMS, TeamIssueType } from '@application/teams/domain/enums/team.enums';
import { IUserRepository } from '@application/users/repositories/user.repository';
import { INotifier } from '@application/webhooks/notifier.port';
import { WebhookEvent } from '@application/app-settings/domain/webhook.types';
import { ICycleRepository } from '@application/cycles/repositories/cycle.repository';
import { CycleStatus } from '@application/cycles/domain/enums/cycle.enums';
import { todayISO } from '@application/cycles/domain/cycle-dates';
import { RecordActivityUseCase } from '@application/audit-log/use-cases';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { CreateIssueDto } from '../dtos/create-issue.dto';
import { IssueEntity } from '../domain/entities/issue.entity';
import { ISSUE_REF_PREFIX, IssueKind } from '../domain/enums/issue.enums';
import { IIssueRepository } from '../repositories/issue.repository';
import { resolveIssueAssignees } from './resolve-assignees';

export interface CreateIssueRequest {
  tenantId: string;
  createdBy: string;
  createdByName: string;
  dto: CreateIssueDto;
}

@Injectable()
export class CreateIssueUseCase
  implements IUsecaseExecute<CreateIssueRequest, Result<IssueEntity>>
{
  constructor(
    @Inject(IIssueRepository) private readonly issues: IIssueRepository,
    @Inject(IUserRepository) private readonly users: IUserRepository,
    @Inject(ITeamRepository) private readonly teams: ITeamRepository,
    @Inject(ICycleRepository) private readonly cycles: ICycleRepository,
    @Inject(INotifier) private readonly notifier: INotifier,
    private readonly counters: CounterService,
    private readonly activity: RecordActivityUseCase,
  ) {}

  async execute({
    tenantId,
    createdBy,
    createdByName,
    dto,
  }: CreateIssueRequest): Promise<Result<IssueEntity>> {
    // A personal issue is always a private task (bugs are never personal).
    const kind = dto.personal ? IssueKind.TASK : dto.kind;
    const isBug = kind === IssueKind.BUG;

    // `assigneeIds` is the list; `assigneeId` is the one-person shorthand still
    // used by quick-add, MCP and the bulk bar.
    const wanted = dto.assigneeIds ?? (dto.assigneeId ? [dto.assigneeId] : []);
    const resolved = await resolveIssueAssignees(this.users, tenantId, wanted);
    if (resolved.isFailure) return Result.fail(resolved.error as string);
    const assignees = resolved.getValue();

    // A personal task lives in no team; otherwise the issue lands in the tenant's
    // team for its kind (the passed team, or the workspace default — QC for bugs,
    // Engineering for tasks).
    const issueType = isBug ? TeamIssueType.BUG : TeamIssueType.TASK;
    const team = dto.personal
      ? null
      : await this.teams.findByKey(
          tenantId,
          DEFAULT_TEAMS.find((t) => t.issueType === issueType)!.key,
        );

    const teamId = dto.personal ? '' : dto.teamId || team?.id.toString() || '';

    // `team` is the kind's *default* team; the issue may land in a different one
    // (dto.teamId). Both the cycle rhythm and the ticket ref read the **landing**
    // team, so resolve it once here rather than twice further down.
    const landingTeam = !teamId
      ? null
      : team && team.id.toString() === teamId
        ? team
        : await this.teams.findById(tenantId, teamId);

    // Born into a cycle. Two ways in:
    //  1. An explicit cycleId (a board filtered to one creates into it) — validated
    //     like the update path: the issue's own team's cycle, still open, never on a
    //     personal task. Otherwise the card would "save" and instantly vanish from the
    //     filtered board (the teamId pitfall all over again).
    //  2. Auto-add: no cycle named, but the landing team runs cycles → join its
    //     ACTIVE cycle, so new work shows under "Current" instead of an invisible
    //     no-cycle backlog (Scrum — new work enters the sprint). No active cycle
    //     (cooldown, or cycles off) ⇒ it stays cycle-less.
    let cycleId = dto.cycleId;
    if (cycleId) {
      if (dto.personal) return Result.fail('Personal tasks cannot join a cycle');
      const cycle = await this.cycles.findById(tenantId, cycleId);
      if (!cycle || cycle.teamId !== teamId) return Result.fail('Cycle not found');
      if (cycle.statusOn(todayISO()) === CycleStatus.COMPLETED) {
        return Result.fail('Completed cycles cannot take new issues');
      }
    } else if (!dto.personal && teamId) {
      if (landingTeam?.cyclesEnabled) {
        const active = (await this.cycles.findByTeam(tenantId, teamId)).find(
          (c) => c.statusOn(todayISO()) === CycleStatus.ACTIVE,
        );
        if (active) cycleId = active.id.toString();
      }
    }

    // Ticket refs are the landing team's sequence — `ENG-14`. A team from an
    // older build has no prefix yet (the backfill may not have run), and a
    // personal task has no team at all; both fall back to the kind's own
    // sequence, so the ref is still sequential and sortable, just not
    // team-scoped.
    //
    // The prefix is re-read here rather than taken from the `landingTeam` above,
    // because that row was fetched two round-trips ago (assignees, cycles) and an
    // admin can move the team's prefix in between. The freeze that normally
    // prevents a prefix move only refuses once the counter has advanced — and this
    // create has not drawn yet, so the counter still reads 0 and the move is
    // allowed. Minting from the stale value would draw `T:ENG` → 1 and stamp
    // `ENG-1` on a team now called `PLT`: the counter for `ENG` is permanently
    // ahead of a prefix no team holds, so a future team derived as `ENG` reports
    // itself frozen before issuing a single ticket and starts at `ENG-2`.
    //
    // Residual window: the prefix can still move between this read and the draw
    // below. That is a single `await` rather than three, and closing it fully would
    // need the counter draw and the freeze check in one transaction — much more
    // machinery than the failure justifies. The cost of the remaining window is
    // also the *smaller* half of the original: the re-read sees any move that
    // completed before the draw started, so the only losing interleaving left is
    // one that commits inside the draw itself.
    const mintFrom = teamId ? (await this.teams.findById(tenantId, teamId)) ?? landingTeam : null;
    const refPrefix = mintFrom?.refPrefix || ISSUE_REF_PREFIX[kind];
    // `sequentialRef` throws if it cannot find a free number; this use-case's
    // contract is a Result, and an uncaught throw here would surface as a 500
    // instead of a message the caller can act on.
    let minted: MintedRef;
    try {
      minted = await sequentialRef(this.counters, tenantId, refPrefix, (ref) =>
        this.issues.findByRef(tenantId, ref).then((i) => i !== null),
      );
    } catch (error) {
      return Result.fail((error as Error).message);
    }

    const created = IssueEntity.create({
      kind,
      tenantId,
      teamId,
      cycleId,
      ownerId: dto.personal ? createdBy : '',
      parentId: dto.parentId,
      shortId: minted.ref,
      refPrefix: minted.prefix,
      refSeq: minted.seq,
      title: dto.title,
      description: dto.description,
      status: dto.status,
      roadmapId: dto.roadmapId,
      roadmapItemId: dto.roadmapItemId,
      roadmapItemLabel: dto.roadmapItemLabel,
      projectId: dto.projectId,
      assignees,
      createdBy,
      createdByName,
      // A bug's reporter is its creator; a task has no reporter.
      reporterId: isBug ? createdBy : '',
      reporterName: isBug ? createdByName : '',
      startDate: dto.startDate,
      endDate: dto.endDate,
      dueDate: dto.dueDate,
      estimate: dto.estimate,
      severity: dto.severity,
      type: dto.type,
      caseId: dto.caseId,
      caseLabel: dto.caseLabel,
      reportId: dto.reportId,
    });
    if (created.isFailure) return Result.fail(created.error as string);

    const issue = created.getValue();
    await this.issues.save(issue);

    await this.activity.execute({
      tenantId,
      entity: AuditEntity.ISSUE,
      entityId: issue.id.toString(),
      entityRef: issue.shortId || issue.id.toString(),
      actor: { type: AuditActor.USER, id: createdBy, name: createdByName },
      changes: [{ field: 'created', oldValue: '', newValue: '' }],
    });

    // Preserve the bug's outbound webhooks (best-effort, never blocks the response).
    if (isBug) {
      const severityLabel: Record<string, string> = {
        low: 'Low',
        medium: 'Medium',
        high: 'High',
        critical: 'Critical',
      };
      await this.notifier.notify(
        tenantId,
        WebhookEvent.BUG_CREATED,
        [
          `🐛 New bug reported: ${issue.title}`,
          `Severity: ${severityLabel[issue.severity] ?? issue.severity}`,
          `Type: ${issue.type}`,
          `Status: ${issue.status}`,
          `Reporter: ${createdByName}`,
          // Everyone on it, so a shared bug doesn't read as one person's.
          assignees.length ? `Assigned to: ${assignees.map((a) => a.name).join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        { link: `/bugs/${issue.shortId}` },
      );
      if (assignees.length) {
        await this.notifier.notify(
          tenantId,
          WebhookEvent.BUG_ASSIGNED,
          [`📌 Bug assigned: ${issue.title}`, `Status: ${issue.status}`].join('\n'),
          // @-pings every assignee whose chat id is mapped.
          { mentionUserIds: assignees.map((a) => a.id), link: `/bugs/${issue.shortId}` },
        );
      }
    }

    return Result.ok(issue);
  }
}
