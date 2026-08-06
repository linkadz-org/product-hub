import { CreateTeamUseCase } from './team.use-cases';
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
