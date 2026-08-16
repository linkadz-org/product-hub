import { GetActivityUseCase } from './get-activity.use-case';
import { AuditEntity } from '../domain/enums/audit.enums';

const visibleIssue = {
  tenantId: 't1',
  isVisibleTo: () => true,
  id: { toString: () => 'i1' },
};
const hiddenIssue = {
  tenantId: 't1',
  isVisibleTo: () => false,
  id: { toString: () => 'i1' },
};

function build(issue: unknown, docPage: unknown = null) {
  const calls: unknown[] = [];
  const audit = {
    findByEntities: async (...args: unknown[]) => {
      calls.push(args);
      return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    },
  };
  const issues = { findById: async () => issue };
  const docPages = { findById: async () => docPage };
  return {
    uc: new GetActivityUseCase(audit as never, issues as never, docPages as never),
    calls,
  };
}

describe('GetActivityUseCase', () => {
  const req = {
    tenantId: 't1',
    requesterId: 'u1',
    isAdmin: false,
    entity: AuditEntity.ISSUE,
    entityId: 'i1',
    query: { page: 1, limit: 50 } as never,
  };

  it('returns history for an issue the caller can see', async () => {
    const { uc, calls } = build(visibleIssue);
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('fails, and never queries, when the caller cannot see the issue', async () => {
    const { uc, calls } = build(hiddenIssue);
    const result = await uc.execute(req);
    expect(result.isFailure).toBe(true);
    // The important half: no query ran, so no entityRef could leak.
    expect(calls).toHaveLength(0);
  });

  it('fails when the issue belongs to another tenant', async () => {
    const { uc } = build({ ...visibleIssue, tenantId: 't2' });
    expect((await uc.execute(req)).isFailure).toBe(true);
  });

  it('fails when the issue does not exist', async () => {
    const { uc } = build(null);
    expect((await uc.execute(req)).isFailure).toBe(true);
  });

  it('refuses an entity kind it cannot guard yet', async () => {
    const { uc, calls } = build(visibleIssue);
    const result = await uc.execute({ ...req, entity: AuditEntity.ROADMAP_ITEM });
    expect(result.isFailure).toBe(true);
    expect(calls).toHaveLength(0);
  });

  describe('doc pages', () => {
    const docReq = { ...req, entity: AuditEntity.DOC_PAGE, entityId: 'p1' };
    const readablePage = { tenantId: 't1' };

    it('returns history for a page in the caller\'s tenant', async () => {
      const { uc, calls } = build(null, readablePage);
      const result = await uc.execute(docReq);
      expect(result.isSuccess).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('fails, and never queries, when the page belongs to another tenant', async () => {
      // Same guard as the authenticated page-detail endpoint: tenant match
      // only. A public share token is a different, unauthenticated route and
      // never reaches this use-case at all — it must not unlock history.
      const { uc, calls } = build(null, { tenantId: 't2' });
      const result = await uc.execute(docReq);
      expect(result.isFailure).toBe(true);
      // The important half: no query ran, so no entityRef could leak.
      expect(calls).toHaveLength(0);
    });

    it('fails, and never queries, when the page does not exist', async () => {
      const { uc, calls } = build(null, null);
      const result = await uc.execute(docReq);
      expect(result.isFailure).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });
});
