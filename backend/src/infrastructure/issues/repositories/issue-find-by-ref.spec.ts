import { IssueRepository } from './issue.repository';

/**
 * `findByRef` resolves the id in a URL. Refs are minted and stored upper case,
 * but sequential refs are short enough to retype from a chat message or a
 * whiteboard — unlike the random `BUG-ESP4F4T` refs that came before them, which
 * were only ever copied. The commit-message parser already accepts any casing, so
 * a lower-case ref that links from a commit but 404s in the address bar is an
 * inconsistency a user will hit, not a theoretical one.
 *
 * The uuid fallback deliberately stays exact: uuids are lower case and are never
 * retyped, so upper-casing one would only break it.
 */
function repoWith(stored: Record<string, unknown>) {
  const queries: Record<string, unknown>[] = [];
  const model = {
    findOne(q: Record<string, unknown>) {
      queries.push(q);
      const key = (q.shortId ?? q._id) as string;
      const hit = key === stored.key ? stored.doc : null;
      return { lean: () => ({ exec: async () => hit }) };
    },
  };
  const repo = new IssueRepository(model as never);
  // The mapper is exercised elsewhere; here only the lookup matters.
  repo.toDomain = ((d: unknown) => d) as never;
  return { repo, queries };
}

const DOC = { _id: 'issue-1', shortId: 'ENG-14' };

describe('IssueRepository.findByRef', () => {
  it('resolves a ref in the casing it was stored in', async () => {
    const { repo } = repoWith({ key: 'ENG-14', doc: DOC });
    await expect(repo.findByRef('t1', 'ENG-14')).resolves.toEqual(DOC);
  });

  it('resolves a lower-case ref', async () => {
    const { repo } = repoWith({ key: 'ENG-14', doc: DOC });
    await expect(repo.findByRef('t1', 'eng-14')).resolves.toEqual(DOC);
  });

  it('resolves a mixed-case ref', async () => {
    const { repo } = repoWith({ key: 'ENG-14', doc: DOC });
    await expect(repo.findByRef('t1', 'EnG-14')).resolves.toEqual(DOC);
  });

  it('upper-cases the shortId lookup but never the uuid fallback', async () => {
    const { repo, queries } = repoWith({ key: 'nothing', doc: null });
    await repo.findByRef('t1', 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');

    expect(queries[0].shortId).toBe('A1B2C3D4-E5F6-7890-ABCD-EF1234567890');
    // A uuid is lower case and is never retyped — upper-casing it would only
    // turn a working legacy link into a 404.
    expect(queries[1]._id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
  });

  it('returns null for a ref that matches nothing', async () => {
    const { repo } = repoWith({ key: 'ENG-14', doc: DOC });
    await expect(repo.findByRef('t1', 'ZZZ-9999')).resolves.toBeNull();
  });
});
