import { CreateTeamUseCase, TEAM_CREATE_RACE_LOST } from './team.use-cases';
import { TeamEntity } from '../domain/entities/team.entity';
import { TeamIssueType } from '../domain/enums/team.enums';

function existing(name: string, key: string, refPrefix: string): TeamEntity {
  return TeamEntity.create({
    tenantId: 't1',
    key,
    name,
    issueType: TeamIssueType.TASK,
    refPrefix,
  }).getValue();
}

function repo(teams: TeamEntity[]) {
  const saved: TeamEntity[] = [];
  return {
    saved,
    findByTenant: async () => teams,
    findByKey: async (_t: string, key: string) => teams.find((x) => x.key === key) ?? null,
    save: async (team: TeamEntity) => {
      saved.push(team);
    },
  };
}

describe('CreateTeamUseCase ref prefix', () => {
  it('derives a prefix from the team name', async () => {
    const teams = repo([]);
    const result = await new CreateTeamUseCase(teams as never).execute({
      tenantId: 't1',
      dto: { name: 'Web Platform', issueType: TeamIssueType.TASK } as never,
    });

    expect(result.isSuccess).toBe(true);
    expect(teams.saved[0].refPrefix).toBe('WEB');
  });

  it('does not collide with a prefix another team already holds', async () => {
    const teams = repo([existing('Web', 'web', 'WEB')]);
    await new CreateTeamUseCase(teams as never).execute({
      tenantId: 't1',
      dto: { name: 'Web Platform', issueType: TeamIssueType.TASK } as never,
    });

    expect(teams.saved[0].refPrefix).toBe('WEB2');
  });

  it('never assigns a reserved prefix', async () => {
    const teams = repo([]);
    await new CreateTeamUseCase(teams as never).execute({
      tenantId: 't1',
      dto: { name: 'Bug Triage', issueType: TeamIssueType.BUG } as never,
    });

    expect(teams.saved[0].refPrefix).toBe('BUG2');
  });
});

/**
 * The pre-check reads the tenant's teams and *then* writes, so two simultaneous
 * creates of the same name both derive the same prefix (and the same key) and
 * the loser hits the unique partial index. That has to become a second, correct
 * team — not a 500.
 */
describe('CreateTeamUseCase losing a race to the unique index', () => {
  /** A repo where the first save loses to a racer that just wrote `winner`. */
  function racingRepo(winner: TeamEntity) {
    const attempts: TeamEntity[] = [];
    const saved: TeamEntity[] = [];
    let raced = false;
    const present: TeamEntity[] = [];
    return {
      attempts,
      saved,
      findByTenant: async () => [...present],
      findByKey: async (_t: string, key: string) => present.find((x) => x.key === key) ?? null,
      save: async (team: TeamEntity) => {
        attempts.push(team);
        if (!raced) {
          // The racer's row lands between our read and our write.
          raced = true;
          present.push(winner);
          throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
        }
        present.push(team);
        saved.push(team);
      },
    };
  }

  it('re-derives the prefix and the key instead of surfacing E11000', async () => {
    const winner = existing('Web Platform', 'web-platform', 'WEB');
    const teams = racingRepo(winner);

    const result = await new CreateTeamUseCase(teams as never).execute({
      tenantId: 't1',
      dto: { name: 'Web Platform', issueType: TeamIssueType.TASK } as never,
    });

    expect(result.isSuccess).toBe(true);
    // First attempt collided with the winner; the retry stepped past it on both
    // derived values.
    expect(teams.attempts[0].refPrefix).toBe('WEB');
    expect(teams.saved).toHaveLength(1);
    expect(teams.saved[0].refPrefix).toBe('WEB2');
    expect(teams.saved[0].key).toBe('web-platform-2');
    expect(result.getValue().refPrefix).toBe('WEB2');
  });

  it('fails as a domain result rather than throwing E11000 out of the last attempt', async () => {
    // Every attempt loses. The raw driver error would leave the controller with an
    // unmapped throw and the client with a 500 on what is a retryable conflict.
    const teams = {
      findByTenant: async () => [],
      findByKey: async () => null,
      save: async () => {
        throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 });
      },
    };

    const result = await new CreateTeamUseCase(teams as never).execute({
      tenantId: 't1',
      dto: { name: 'Web Platform', issueType: TeamIssueType.TASK } as never,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe(TEAM_CREATE_RACE_LOST);
  });

  it('rethrows an error that is not a duplicate key', async () => {
    const teams = {
      findByTenant: async () => [],
      findByKey: async () => null,
      save: async () => {
        throw new Error('connection reset');
      },
    };

    await expect(
      new CreateTeamUseCase(teams as never).execute({
        tenantId: 't1',
        dto: { name: 'Web Platform', issueType: TeamIssueType.TASK } as never,
      }),
    ).rejects.toThrow('connection reset');
  });
});
