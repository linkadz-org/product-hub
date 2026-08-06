import { ResolveTeamPrefixLockUseCase } from './team.use-cases';
import { UniqueEntityID } from '@core/domain';
import { TeamEntity } from '../domain/entities/team.entity';
import { TeamIssueType } from '../domain/enums/team.enums';

function team(refPrefix: string, id = 'team-1'): TeamEntity {
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
 * Records every `(tenantId, prefix)` it was asked for, so a test can assert it was
 * never asked — and every `currentMany` call, so a test can assert the list path
 * makes exactly one.
 */
function counters(seqByPrefix: Record<string, number>) {
  const asked: Array<[string, string]> = [];
  const batches: string[][] = [];
  return {
    asked,
    batches,
    current: async (tenantId: string, prefix: string) => {
      asked.push([tenantId, prefix]);
      return seqByPrefix[prefix] ?? 0;
    },
    currentMany: async (tenantId: string, prefixes: string[]) => {
      batches.push([...prefixes]);
      // Mirrors the real service: falsy dropped, duplicates collapsed, misses 0.
      const wanted = [...new Set(prefixes.filter((p) => !!p))];
      for (const p of wanted) asked.push([tenantId, p]);
      return new Map(wanted.map((p) => [p, seqByPrefix[p] ?? 0]));
    },
  };
}

function subject(c: ReturnType<typeof counters>): ResolveTeamPrefixLockUseCase {
  return new ResolveTeamPrefixLockUseCase(c as never);
}

describe('ResolveTeamPrefixLockUseCase', () => {
  describe('one', () => {
    it('locks a prefix whose sequence has minted a ref', async () => {
      const c = counters({ ENG: 7 });
      expect(await subject(c).one('t1', team('ENG'))).toBe(true);
      expect(c.asked).toEqual([['t1', 'ENG']]);
    });

    it('leaves a prefix editable while its sequence is untouched', async () => {
      const c = counters({ ENG: 0 });
      expect(await subject(c).one('t1', team('ENG'))).toBe(false);
    });

    it('locks on the very first minted ref', async () => {
      // The boundary is > 0, not > 1: ENG-1 already exists in someone's commit.
      const c = counters({ ENG: 1 });
      expect(await subject(c).one('t1', team('ENG'))).toBe(true);
    });

    it('never queries the counter for a team with no prefix', async () => {
      // A legacy team reads back with refPrefix '' — asking the store would query
      // the meaningless key `t1:` and could freeze a team that has minted nothing.
      const c = counters({});
      expect(await subject(c).one('t1', team(''))).toBe(false);
      expect(c.asked).toHaveLength(0);
    });

    it('scopes the lookup to the tenant it was given', async () => {
      const c = counters({ ENG: 3 });
      await subject(c).one('t-other', team('ENG'));
      expect(c.asked).toEqual([['t-other', 'ENG']]);
    });
  });

  describe('many', () => {
    it('pairs each result with its own team by index', async () => {
      const c = counters({ ENG: 4, WEB: 0, OPS: 2 });
      const result = await subject(c).many('t1', [
        team('ENG', 'a'),
        team('WEB', 'b'),
        team('', 'c'),
        team('OPS', 'd'),
      ]);

      expect(result).toEqual([true, false, false, true]);
      // The prefix-less team is skipped, so only the three real prefixes are asked for.
      expect(c.asked.map(([, p]) => p).sort()).toEqual(['ENG', 'OPS', 'WEB']);
    });

    it('reads every team in a single batched query', async () => {
      // The whole point of the batch: /v1/teams is fetched on nearly every page
      // load, so this must not scale with team count.
      const c = counters({ ENG: 4, WEB: 1, OPS: 2 });
      await subject(c).many('t1', [team('ENG', 'a'), team('WEB', 'b'), team('OPS', 'c')]);
      expect(c.batches).toHaveLength(1);
    });

    it('keeps results positionally paired even with duplicate prefixes', async () => {
      // The caller zips by index. Two teams sharing a prefix collapse to one key
      // in the query and must both still resolve.
      const c = counters({ ENG: 5, WEB: 0 });
      const result = await subject(c).many('t1', [
        team('ENG', 'a'),
        team('WEB', 'b'),
        team('ENG', 'c'),
      ]);
      expect(result).toEqual([true, false, true]);
    });

    it('never queries the counter when no team has a prefix', async () => {
      const c = counters({});
      const result = await subject(c).many('t1', [team('', 'a'), team('', 'b')]);
      expect(result).toEqual([false, false]);
      expect(c.batches).toHaveLength(0);
      expect(c.asked).toHaveLength(0);
    });

    it('scopes the batch to the tenant it was given', async () => {
      const c = counters({ ENG: 3 });
      await subject(c).many('t-other', [team('ENG', 'a')]);
      expect(c.asked).toEqual([['t-other', 'ENG']]);
    });

    it('returns an empty list for no teams', async () => {
      const c = counters({});
      expect(await subject(c).many('t1', [])).toEqual([]);
      expect(c.asked).toHaveLength(0);
      expect(c.batches).toHaveLength(0);
    });
  });
});
