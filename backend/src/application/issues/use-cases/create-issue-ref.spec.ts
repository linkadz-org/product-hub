import { CreateIssueUseCase } from './create-issue.use-case';
import { IssueKind } from '../domain/enums/issue.enums';
import { UniqueEntityID } from '@core/domain';
import { TeamEntity } from '@application/teams/domain/entities/team.entity';
import { TeamIssueType } from '@application/teams/domain/enums/team.enums';

function teamWith(refPrefix?: string): TeamEntity {
  return TeamEntity.create(
    {
      tenantId: 't1',
      key: 'engineering',
      name: 'Engineering',
      issueType: TeamIssueType.TASK,
      refPrefix,
    },
    new UniqueEntityID('team-1'),
  ).getValue();
}

function build(team: TeamEntity | null) {
  const saved: { shortId: string; refPrefix?: string; refSeq?: number }[] = [];
  let seq = 0;
  const useCase = new CreateIssueUseCase(
    {
      findByRef: async () => null,
      save: async (issue: { shortId: string; refPrefix?: string; refSeq?: number }) => {
        saved.push({ shortId: issue.shortId, refPrefix: issue.refPrefix, refSeq: issue.refSeq });
        return issue;
      },
    } as never,
    { findManyByIds: async () => [], findById: async () => null } as never,
    { findByKey: async () => team, findById: async () => team } as never,
    { findById: async () => null, findByTeam: async () => [] } as never,
    { notify: async () => undefined } as never,
    { next: async () => ++seq, current: async () => seq } as never,
  );
  return { useCase, saved };
}

describe('CreateIssueUseCase ref minting', () => {
  it("uses the landing team's prefix and numbers sequentially", async () => {
    const { useCase, saved } = build(teamWith('ENG'));

    for (const title of ['first', 'second']) {
      const result = await useCase.execute({
        tenantId: 't1',
        createdBy: 'u1',
        createdByName: 'U',
        dto: { kind: IssueKind.TASK, title } as never,
      });
      expect(result.isSuccess).toBe(true);
    }

    expect(saved.map((s) => s.shortId)).toEqual(['ENG-1', 'ENG-2']);
    expect(saved[1]).toMatchObject({ refPrefix: 'ENG', refSeq: 2 });
  });

  it('falls back to the kind prefix when the team has none yet', async () => {
    // Code ships before the backfill runs; a team from an older build has no
    // prefix and must still mint a sortable ref rather than failing.
    const { useCase, saved } = build(teamWith(undefined));

    await useCase.execute({
      tenantId: 't1',
      createdBy: 'u1',
      createdByName: 'U',
      dto: { kind: IssueKind.TASK, title: 'x' } as never,
    });

    expect(saved[0]).toMatchObject({ shortId: 'TSK-1', refPrefix: 'TSK', refSeq: 1 });
  });

  it('numbers a personal task under TSK, since it has no team', async () => {
    const { useCase, saved } = build(null);

    await useCase.execute({
      tenantId: 't1',
      createdBy: 'u1',
      createdByName: 'U',
      dto: { personal: true, title: 'mine' } as never,
    });

    expect(saved[0]).toMatchObject({ shortId: 'TSK-1', refPrefix: 'TSK', refSeq: 1 });
  });
});
