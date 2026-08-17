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

function build(issue: unknown, docPage: unknown = null, roadmap: unknown = null) {
  const calls: unknown[] = [];
  const audit = {
    findByEntities: async (...args: unknown[]) => {
      calls.push(args);
      return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    },
  };
  const issues = {
    findById: async () => issue,
    findChildren: async () => [],
  };
  const docPages = {
    findById: async () => docPage,
    findByLinkRef: async () => [],
  };
  const roadmaps = { findByItemId: async () => roadmap };
  const reports = { findById: async () => null };
  return {
    uc: new GetActivityUseCase(
      audit as never,
      issues as never,
      docPages as never,
      roadmaps as never,
      reports as never,
    ),
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

  it('refuses an entity kind it cannot guard at all', async () => {
    const { uc, calls } = build(visibleIssue);
    const result = await uc.execute({ ...req, entity: 'nonsense' as AuditEntity });
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

  describe('roadmap items', () => {
    // entityId here is the ITEM's id, not the roadmap's — the request never
    // carries a roadmapId, so the guard has to resolve the containing roadmap
    // from the item id alone (IRoadmapRepository#findByItemId).
    const itemReq = { ...req, entity: AuditEntity.ROADMAP_ITEM, entityId: 'it1' };
    const readableRoadmap = { tenantId: 't1' };

    it('returns history for an item whose roadmap is in the caller\'s tenant', async () => {
      const { uc, calls } = build(null, null, readableRoadmap);
      const result = await uc.execute(itemReq);
      expect(result.isSuccess).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('fails, and runs no query, when the item has no independent access rule and its roadmap is unreadable', async () => {
      // Items have no independent access rule — the only guard is the
      // roadmap that contains them. An unreadable roadmap (different tenant)
      // must fail without ever touching the audit log.
      const { uc, calls } = build(null, null, { tenantId: 't2' });
      const result = await uc.execute(itemReq);
      expect(result.isFailure).toBe(true);
      // The important half: no query ran, so no entityRef could leak.
      expect(calls).toHaveLength(0);
    });

    it('fails, and never queries, when no roadmap embeds this item', async () => {
      const { uc, calls } = build(null, null, null);
      const result = await uc.execute(itemReq);
      expect(result.isFailure).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });

  /**
   * The anti-oracle property, and the whole reason every refusal is the same
   * literal string.
   *
   * The controller propagates `result.error` into the exception message, so the
   * message reaches the response BODY. If any one exit said "Issue not found"
   * — the string `get-issue.use-case.ts` uses, and the natural thing to write
   * when copying it — a stranger could tell "this id exists but you can't see
   * it" from "this id doesn't exist", just by reading the body. Every other
   * test here asserts only `isFailure`, so that change would leave the suite
   * entirely green.
   *
   * This pins the property itself: all five refusals, one message. It does not
   * assert WHICH message, because the requirement is uniformity, not wording.
   */
  it('refuses every failure case with one identical message — no existence oracle', async () => {
    const errors = await Promise.all([
      // missing issue
      build(null).uc.execute(req),
      // issue in another tenant
      build({ ...visibleIssue, tenantId: 't2' }).uc.execute(req),
      // issue the caller cannot see
      build(hiddenIssue).uc.execute(req),
      // missing doc page / doc page in another tenant
      build(null, null).uc.execute({ ...req, entity: AuditEntity.DOC_PAGE, entityId: 'p1' }),
      build(null, { tenantId: 't2' }).uc.execute({
        ...req,
        entity: AuditEntity.DOC_PAGE,
        entityId: 'p1',
      }),
      // missing roadmap item / item whose roadmap is in another tenant
      build(null, null, null).uc.execute({
        ...req,
        entity: AuditEntity.ROADMAP_ITEM,
        entityId: 'it1',
      }),
      build(null, null, { tenantId: 't2' }).uc.execute({
        ...req,
        entity: AuditEntity.ROADMAP_ITEM,
        entityId: 'it1',
      }),
      // an entity kind with no guard at all
      build(visibleIssue).uc.execute({ ...req, entity: 'nonsense' as AuditEntity }),
    ]);

    expect(errors.every((r) => r.isFailure)).toBe(true);
    expect(new Set(errors.map((r) => r.error)).size).toBe(1);
    // …and it names nothing about the object that was asked for.
    const [message] = errors.map((r) => String(r.error));
    expect(message.toLowerCase()).not.toContain('issue');
    expect(message.toLowerCase()).not.toContain('page');
    expect(message.toLowerCase()).not.toContain('roadmap');
  });
});
