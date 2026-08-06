import {
  UpdateTeamUseCase,
  TEAM_PREFIX_FROZEN,
  TEAM_PREFIX_TAKEN,
} from './team.use-cases';
import { UniqueEntityID } from '@core/domain';
import { TeamEntity } from '../domain/entities/team.entity';
import { TeamIssueType } from '../domain/enums/team.enums';

function team(refPrefix: string, id = 'team-1'): TeamEntity {
  // `UniqueEntityID` takes a string and is what the entity stores — a hand-rolled
  // `{toString}` stub is not interchangeable with it.
  return TeamEntity.create(
    {
      tenantId: 't1',
      key: 'engineering',
      name: 'Engineering',
      issueType: TeamIssueType.TASK,
      refPrefix,
    },
    new UniqueEntityID(id),
  ).getValue();
}

/**
 * `seq` is the tenant's counter for the subject's prefix — the stub mirrors
 * `ResolveTeamPrefixLockUseCase.one`, which is what `UpdateTeamUseCase` now asks
 * instead of reading `CounterService` itself. Stubbing the lock rather than the
 * counter is the point of that refactor: there is one definition of "locked", so
 * there is one thing to stub.
 */
function deps(subject: TeamEntity, others: TeamEntity[] = [], seq = 0) {
  const saved: TeamEntity[] = [];
  return {
    saved,
    teams: {
      findById: async () => subject,
      findByTenant: async () => [subject, ...others],
      save: async (t: TeamEntity) => {
        saved.push(t);
      },
    },
    prefixLock: { one: async (_tenantId: string, t: TeamEntity) => !!t.refPrefix && seq > 0 },
  };
}

describe('UpdateTeamUseCase refPrefix', () => {
  it('changes the prefix while the sequence is untouched', async () => {
    const subject = team('ENG');
    const d = deps(subject, [], 0);
    const result = await new UpdateTeamUseCase(d.teams as never, d.prefixLock as never).execute({
      tenantId: 't1',
      id: 'team-1',
      dto: { refPrefix: 'plt' } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(d.saved[0].refPrefix).toBe('PLT');
  });

  it('refuses once the sequence has minted a ref', async () => {
    const subject = team('ENG');
    const d = deps(subject, [], 7);
    const result = await new UpdateTeamUseCase(d.teams as never, d.prefixLock as never).execute({
      tenantId: 't1',
      id: 'team-1',
      dto: { refPrefix: 'PLT' } as never,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(TEAM_PREFIX_FROZEN);
    expect(d.saved).toHaveLength(0);
  });

  it('refuses a prefix another team already holds', async () => {
    const subject = team('ENG');
    const d = deps(subject, [team('WEB', 'team-2')], 0);
    const result = await new UpdateTeamUseCase(d.teams as never, d.prefixLock as never).execute({
      tenantId: 't1',
      id: 'team-1',
      dto: { refPrefix: 'WEB' } as never,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(TEAM_PREFIX_TAKEN);
  });

  it('accepts re-submitting the prefix the team already has', async () => {
    const subject = team('ENG');
    const d = deps(subject, [], 4);
    const result = await new UpdateTeamUseCase(d.teams as never, d.prefixLock as never).execute({
      tenantId: 't1',
      id: 'team-1',
      dto: { refPrefix: 'ENG' } as never,
    });

    // A no-op must not trip the freeze — the settings form submits every field.
    expect(result.isSuccess).toBe(true);
  });

  it('leaves the prefix alone when the dto omits it', async () => {
    const subject = team('ENG');
    const d = deps(subject, [], 9);
    const result = await new UpdateTeamUseCase(d.teams as never, d.prefixLock as never).execute({
      tenantId: 't1',
      id: 'team-1',
      dto: { name: 'Platform' } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(d.saved[0].refPrefix).toBe('ENG');
  });
});

/**
 * The `others.some(...)` pre-check reads and *then* writes, so a create deriving
 * the same prefix can land in between. The unique partial index is the real guard,
 * and its rejection must reach the settings form as the same field-level 400 the
 * pre-check produces — not as a 500.
 */
describe('UpdateTeamUseCase losing a race to the unique index', () => {
  /** Deps whose save always loses to a racer that just took the wanted prefix. */
  function racingDeps(subject: TeamEntity, error: unknown) {
    return {
      teams: {
        findById: async () => subject,
        // The winner's row is not visible yet — that is the whole race.
        findByTenant: async () => [subject],
        save: async () => {
          throw error;
        },
      },
      prefixLock: { one: async () => false },
    };
  }

  it('converts a lost race into TEAM_PREFIX_TAKEN', async () => {
    const d = racingDeps(
      team('ENG'),
      Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
    );

    const result = await new UpdateTeamUseCase(d.teams as never, d.prefixLock as never).execute({
      tenantId: 't1',
      id: 'team-1',
      dto: { refPrefix: 'WEB' } as never,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(TEAM_PREFIX_TAKEN);
  });

  it('rethrows an error that is not a duplicate key', async () => {
    const d = racingDeps(team('ENG'), new Error('connection reset'));

    await expect(
      new UpdateTeamUseCase(d.teams as never, d.prefixLock as never).execute({
        tenantId: 't1',
        id: 'team-1',
        dto: { refPrefix: 'WEB' } as never,
      }),
    ).rejects.toThrow('connection reset');
  });

  it('rethrows a duplicate key raised by an update that never touched the prefix', async () => {
    // Only a prefix move can be read as "prefix taken". Anything else duplicating
    // is a genuine fault and must not be dressed up as a field error.
    const d = racingDeps(
      team('ENG'),
      Object.assign(new Error('E11000 duplicate key error'), { code: 11000 }),
    );

    await expect(
      new UpdateTeamUseCase(d.teams as never, d.prefixLock as never).execute({
        tenantId: 't1',
        id: 'team-1',
        dto: { name: 'Platform' } as never,
      }),
    ).rejects.toThrow('E11000');
  });
});
