import { CreateIssueUseCase } from './create-issue.use-case';
import { IssueKind } from '../domain/enums/issue.enums';
import { UniqueEntityID } from '@core/domain';
import { TeamEntity } from '@application/teams/domain/entities/team.entity';
import { DEFAULT_TEAMS, TeamIssueType } from '@application/teams/domain/enums/team.enums';
import { CycleStatus } from '@application/cycles/domain/enums/cycle.enums';

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
    counterStub(() => ++seq),
  );
  return { useCase, saved };
}

/** The `CounterService` surface `sequentialRef` uses. */
function counterStub(next: () => number) {
  let last = 0;
  return {
    next: async () => (last = next()),
    current: async () => last,
    ensureAtLeast: async () => undefined,
  } as never;
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

function namedTeam(
  id: string,
  key: string,
  name: string,
  refPrefix: string,
  cyclesEnabled = false,
): TeamEntity {
  return TeamEntity.create(
    {
      tenantId: 't1',
      key,
      name,
      issueType: TeamIssueType.TASK,
      refPrefix,
      cyclesEnabled,
    },
    new UniqueEntityID(id),
  ).getValue();
}

/**
 * The `landingTeam` lookup is hoisted out of the cycle branch and now feeds BOTH
 * the cycle auto-join and the ticket prefix. A stub that returns the same team
 * from `findByKey` and `findById` cannot tell the two apart, so these build a
 * repo where the kind's **default** team and the team the issue actually lands in
 * are different rows with different prefixes — which is the ordinary MCP call,
 * since MCP always passes an explicit `teamId`.
 */
function buildTeams(teams: TeamEntity[], defaultKey: string, cycles: CycleStub = {}) {
  const saved: { shortId: string; teamId: string; cycleId: string }[] = [];
  const calls: { findById: string[] } = { findById: [] };
  let seq = 0;
  const useCase = new CreateIssueUseCase(
    {
      findByRef: async () => null,
      save: async (issue: { shortId: string; teamId: string; cycleId: string }) => {
        saved.push({ shortId: issue.shortId, teamId: issue.teamId, cycleId: issue.cycleId });
        return issue;
      },
    } as never,
    { findManyByIds: async () => [], findById: async () => null } as never,
    {
      findByKey: async (_t: string, key: string) =>
        key === defaultKey ? teams.find((x) => x.key === key) ?? null : null,
      findById: async (_t: string, id: string) => {
        calls.findById.push(id);
        return teams.find((x) => x.id.toString() === id) ?? null;
      },
    } as never,
    { findById: async () => null, findByTeam: async () => cycles.byTeam ?? [] } as never,
    { notify: async () => undefined } as never,
    counterStub(() => ++seq),
  );
  return { useCase, saved, calls };
}

interface CycleStub {
  byTeam?: { id: UniqueEntityID; statusOn: () => CycleStatus }[];
}

describe('CreateIssueUseCase landing team', () => {
  const DEFAULT_TASK_KEY = DEFAULT_TEAMS.find((t) => t.issueType === TeamIssueType.TASK)!.key;

  it('mints from the team the issue lands in, not the kind default', async () => {
    const fallback = namedTeam('team-default', DEFAULT_TASK_KEY, 'Engineering', 'ENG');
    const landing = namedTeam('team-mobile', 'mobile', 'Mobile', 'MOB');
    const { useCase, saved, calls } = buildTeams([fallback, landing], DEFAULT_TASK_KEY);

    const result = await useCase.execute({
      tenantId: 't1',
      createdBy: 'u1',
      createdByName: 'U',
      dto: { kind: IssueKind.TASK, title: 'from MCP', teamId: 'team-mobile' } as never,
    });

    expect(result.isSuccess).toBe(true);
    // The `await this.teams.findById(...)` arm — the primary MCP path — plus the
    // re-read taken immediately before the draw.
    expect(calls.findById).toEqual(['team-mobile', 'team-mobile']);
    expect(saved[0]).toMatchObject({ shortId: 'MOB-1', teamId: 'team-mobile' });
  });

  it('resolves the landing team once, then re-reads only the prefix before minting', async () => {
    const fallback = namedTeam('team-default', DEFAULT_TASK_KEY, 'Engineering', 'ENG');
    const { useCase, saved, calls } = buildTeams([fallback], DEFAULT_TASK_KEY);

    await useCase.execute({
      tenantId: 't1',
      createdBy: 'u1',
      createdByName: 'U',
      dto: { kind: IssueKind.TASK, title: 'plain', teamId: 'team-default' } as never,
    });

    // Landing in the kind default costs no lookup to *resolve* — that row is
    // already in hand. The one read is the deliberate pre-draw refresh.
    expect(calls.findById).toEqual(['team-default']);
    expect(saved[0].shortId).toBe('ENG-1');
  });

  it('falls back to the kind sequence when the landing team has no prefix', async () => {
    const fallback = namedTeam('team-default', DEFAULT_TASK_KEY, 'Engineering', 'ENG');
    const landing = TeamEntity.create(
      { tenantId: 't1', key: 'mobile', name: 'Mobile', issueType: TeamIssueType.TASK },
      new UniqueEntityID('team-mobile'),
    ).getValue();
    const { useCase, saved } = buildTeams([fallback, landing], DEFAULT_TASK_KEY);

    await useCase.execute({
      tenantId: 't1',
      createdBy: 'u1',
      createdByName: 'U',
      dto: { kind: IssueKind.TASK, title: 'x', teamId: 'team-mobile' } as never,
    });

    // Never the *default* team's ENG — that would print another team's prefix
    // on this team's ticket.
    expect(saved[0].shortId).toBe('TSK-1');
  });

  it('joins the landing team’s active cycle and mints from the same team', async () => {
    // Both consumers of `landingTeam` at once: a regression that resolved the
    // wrong team would break exactly one of these two assertions.
    const fallback = namedTeam('team-default', DEFAULT_TASK_KEY, 'Engineering', 'ENG', false);
    const landing = namedTeam('team-mobile', 'mobile', 'Mobile', 'MOB', true);
    const { useCase, saved } = buildTeams([fallback, landing], DEFAULT_TASK_KEY, {
      byTeam: [{ id: new UniqueEntityID('cycle-9'), statusOn: () => CycleStatus.ACTIVE }],
    });

    await useCase.execute({
      tenantId: 't1',
      createdBy: 'u1',
      createdByName: 'U',
      dto: { kind: IssueKind.TASK, title: 'sprint work', teamId: 'team-mobile' } as never,
    });

    expect(saved[0]).toMatchObject({ shortId: 'MOB-1', cycleId: 'cycle-9' });
  });

  it('leaves the issue cycle-less when the landing team does not run cycles', async () => {
    // The default team has cycles on; the landing team does not. Reading the
    // default here would silently file the ticket into another team's sprint.
    const fallback = namedTeam('team-default', DEFAULT_TASK_KEY, 'Engineering', 'ENG', true);
    const landing = namedTeam('team-mobile', 'mobile', 'Mobile', 'MOB', false);
    const { useCase, saved } = buildTeams([fallback, landing], DEFAULT_TASK_KEY, {
      byTeam: [{ id: new UniqueEntityID('cycle-9'), statusOn: () => CycleStatus.ACTIVE }],
    });

    await useCase.execute({
      tenantId: 't1',
      createdBy: 'u1',
      createdByName: 'U',
      dto: { kind: IssueKind.TASK, title: 'backlog work', teamId: 'team-mobile' } as never,
    });

    expect(saved[0]).toMatchObject({ shortId: 'MOB-1', cycleId: '' });
  });
});

/**
 * A prefix change that lands while a create is in flight.
 *
 * The create reads the team early (it needs the row for the cycle rhythm), then
 * makes more round-trips before drawing its number. An admin PATCHing the prefix
 * in that gap is *allowed* to — the freeze only refuses once the counter has
 * moved, and this create has not drawn yet — so the write goes through and the
 * create is left holding a prefix no team owns any more.
 */
describe('CreateIssueUseCase against a prefix change mid-create', () => {
  const DEFAULT_TASK_KEY = DEFAULT_TEAMS.find((t) => t.issueType === TeamIssueType.TASK)!.key;

  it('mints from the prefix the team holds at draw time, not the one it held at read time', async () => {
    const drawn: string[] = [];
    const saved: { shortId: string; refPrefix?: string }[] = [];
    // One row, mutated between the two reads — exactly what the admin's PATCH does.
    let current = namedTeam('team-1', DEFAULT_TASK_KEY, 'Engineering', 'ENG', true);
    let reads = 0;
    const teams = {
      findByKey: async () => current,
      findById: async () => {
        reads++;
        // The PATCH commits after the create's first read of the team and before
        // its second. `T:ENG` is still 0, so the freeze check let it through.
        if (reads === 1) current = namedTeam('team-1', DEFAULT_TASK_KEY, 'Engineering', 'PLT', true);
        return current;
      },
    };
    let seq = 0;
    const useCase = new CreateIssueUseCase(
      {
        findByRef: async () => null,
        save: async (issue: { shortId: string; refPrefix?: string }) => {
          saved.push({ shortId: issue.shortId, refPrefix: issue.refPrefix });
          return issue;
        },
      } as never,
      { findManyByIds: async () => [], findById: async () => null } as never,
      teams as never,
      { findById: async () => null, findByTeam: async () => [] } as never,
      { notify: async () => undefined } as never,
      {
        next: async (_t: string, prefix: string) => {
          drawn.push(prefix);
          return ++seq;
        },
        current: async () => seq,
        ensureAtLeast: async () => undefined,
      } as never,
    );

    const result = await useCase.execute({
      tenantId: 't1',
      createdBy: 'u1',
      createdByName: 'U',
      dto: { kind: IssueKind.TASK, title: 'racing', teamId: 'team-1' } as never,
    });

    expect(result.isSuccess).toBe(true);
    // Stale `ENG` would leave `T:ENG` at 1 with no team holding `ENG` — permanent
    // and invisible, and it would print another team's prefix on this ticket.
    expect(drawn).toEqual(['PLT']);
    expect(saved[0]).toMatchObject({ shortId: 'PLT-1', refPrefix: 'PLT' });
  });
});
