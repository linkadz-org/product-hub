import { IssueRepository } from './issue.repository';
import { IssueDoc } from '../entities/issue.schema';

/**
 * The sortable halves of a sequential ref (`refPrefix` / `refSeq`) only reach the
 * database through `toDocument`, and only reach the ID sort's callers through
 * `toDomain`. Nothing else in the suite touches those two lines, so dropping
 * either field from the mapper is a silent regression: every list still renders,
 * every test still passes, and the sort quietly does nothing for anything created
 * afterwards. These tests exercise the mappers directly — no database.
 */
function repo(): IssueRepository {
  // The mappers are pure; the model is never touched by them.
  return new IssueRepository(null as never);
}

function doc(over: Partial<IssueDoc> = {}): IssueDoc {
  return {
    _id: 'issue-1',
    kind: 'task',
    tenantId: 't1',
    teamId: 'team-1',
    ownerId: '',
    parentId: '',
    shortId: 'ENG-14',
    title: 'A ticket',
    description: '',
    status: 'todo',
    createdBy: 'u1',
    createdByName: 'U',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  } as IssueDoc;
}

describe('IssueRepository ref mapping', () => {
  it('round-trips refPrefix and refSeq through toDomain → toDocument', () => {
    const r = repo();
    const entity = r.toDomain(doc({ refPrefix: 'ENG', refSeq: 14 }));

    expect(entity.refPrefix).toBe('ENG');
    expect(entity.refSeq).toBe(14);

    const out = r.toDocument(entity);
    expect(out.refPrefix).toBe('ENG');
    expect(out.refSeq).toBe(14);
    expect(out.shortId).toBe('ENG-14');
  });

  it('keeps refSeq 1 — a real number, not a falsy one to drop', () => {
    const out = repo().toDocument(repo().toDomain(doc({ refPrefix: 'QC', refSeq: 1 })));
    expect(out).toMatchObject({ refPrefix: 'QC', refSeq: 1 });
  });

  describe('a legacy issue, created before sequential refs', () => {
    // The branch's central constraint: an existing issue is never written to.
    // Defaulting either half to '' / 0 on load would (a) make it sort as a real
    // value instead of grouping with the other legacy rows, and (b) materialise
    // the fields on the row the next time anything saved it.
    const legacy = doc({ shortId: 'BUG-ESP4F4T' });

    it('keeps both fields absent through toDomain', () => {
      const entity = repo().toDomain(legacy);
      expect(entity.refPrefix).toBeUndefined();
      expect(entity.refSeq).toBeUndefined();
    });

    it('re-emits neither field, so a save never creates them', () => {
      const out = repo().toDocument(repo().toDomain(legacy));
      expect(out.refPrefix).toBeUndefined();
      expect(out.refSeq).toBeUndefined();
      // Explicitly not the falsy stand-ins.
      expect(out.refPrefix).not.toBe('');
      expect(out.refSeq).not.toBe(0);
    });
  });
});
