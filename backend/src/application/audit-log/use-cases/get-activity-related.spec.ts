import { GetActivityUseCase } from './get-activity.use-case';
import { AuditEntity } from '../domain/enums/audit.enums';

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: { toString: () => (overrides.id as string) ?? 'issue-1' },
    tenantId: 't1',
    isVisibleTo: () => true,
    roadmapItemId: '',
    reportId: '',
    caseId: '',
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function build(opts: {
  rootIssue: unknown;
  children?: unknown[];
  docPages?: unknown[];
  roadmap?: unknown;
  report?: unknown;
}) {
  const calls: unknown[] = [];
  const audit = {
    findByEntities: async (...args: unknown[]) => {
      calls.push(args);
      return { data: [], total: 0, page: 1, limit: 50, totalPages: 0 };
    },
  };
  const issues = {
    findById: async () => opts.rootIssue,
    findChildren: async () => opts.children ?? [],
  };
  const docPages = {
    findById: async () => null,
    findByLinkRef: async () => opts.docPages ?? [],
  };
  const roadmaps = { findByItemId: async () => opts.roadmap ?? null };
  const reports = { findById: async () => opts.report ?? null };

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

const req = {
  tenantId: 't1',
  requesterId: 'u1',
  isAdmin: false,
  entity: AuditEntity.ISSUE,
  entityId: 'issue-1',
  query: { page: 1, limit: 50 } as never,
};

describe('GetActivityUseCase — related history', () => {
  it('returns just the issue\'s own rows when it has no relations', async () => {
    const { uc, calls } = build({ rootIssue: issue() });
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    expect(calls).toHaveLength(1);
    const [, refs] = calls[0] as [string, { entity: AuditEntity; entityId: string }[]];
    expect(refs).toEqual([{ entity: AuditEntity.ISSUE, entityId: 'issue-1' }]);
    expect(result.getValue().relatedTruncated).toBe(false);
  });

  it('includes a visible subtask with relationLabel subtask', async () => {
    const child = issue({ id: 'child-1', updatedAt: new Date('2026-01-05') });
    const { uc, calls } = build({ rootIssue: issue(), children: [child] });
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    const [, refs] = calls[0] as [string, { entity: AuditEntity; entityId: string }[]];
    expect(refs).toContainEqual({ entity: AuditEntity.ISSUE, entityId: 'child-1' });
    expect(result.getValue().labelByEntityId['child-1']).toBe('subtask');
  });

  it('includes an attached doc page with relationLabel doc', async () => {
    const page = { id: { toString: () => 'page-1' }, tenantId: 't1', updatedAt: new Date('2026-01-05') };
    const { uc, calls } = build({ rootIssue: issue(), docPages: [page] });
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    const [, refs] = calls[0] as [string, { entity: AuditEntity; entityId: string }[]];
    expect(refs).toContainEqual({ entity: AuditEntity.DOC_PAGE, entityId: 'page-1' });
    expect(result.getValue().labelByEntityId['page-1']).toBe('doc');
  });

  it('includes the linked roadmap item with relationLabel roadmap_item', async () => {
    const rootIssue = issue({ roadmapItemId: 'item-1' });
    const roadmap = { tenantId: 't1', updatedAt: new Date('2026-01-05') };
    const { uc, calls } = build({ rootIssue, roadmap });
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    const [, refs] = calls[0] as [string, { entity: AuditEntity; entityId: string }[]];
    expect(refs).toContainEqual({ entity: AuditEntity.ROADMAP_ITEM, entityId: 'item-1' });
    expect(result.getValue().labelByEntityId['item-1']).toBe('roadmap_item');
  });

  it('includes the related test case, joined on caseId, with relationLabel testcase', async () => {
    const rootIssue = issue({ reportId: 'report-1', caseId: 'case-1' });
    const report = { tenantId: 't1', updatedAt: new Date('2026-01-05') };
    const { uc, calls } = build({ rootIssue, report });
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    const [, refs] = calls[0] as [string, { entity: AuditEntity; entityId: string }[]];
    // Ref carries the case id (issue.caseId), never the report id — that is
    // what set-test-case-result.use-case.ts stamps on the audit row's
    // entityId, so this is the id that actually joins to those rows.
    expect(refs).toContainEqual({ entity: AuditEntity.TESTCASE, entityId: 'case-1' });
    expect(result.getValue().labelByEntityId['case-1']).toBe('testcase');
  });

  it('a subtask the caller cannot see contributes nothing', async () => {
    const visibleChild = issue({ id: 'child-visible', updatedAt: new Date('2026-01-05') });
    const hiddenChild = issue({
      id: 'child-hidden',
      isVisibleTo: () => false,
      updatedAt: new Date('2026-01-06'),
    });
    const { uc, calls } = build({ rootIssue: issue(), children: [visibleChild, hiddenChild] });
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    const [, refs] = calls[0] as [string, { entity: AuditEntity; entityId: string }[]];
    expect(refs).toContainEqual({ entity: AuditEntity.ISSUE, entityId: 'child-visible' });
    expect(refs).not.toContainEqual({ entity: AuditEntity.ISSUE, entityId: 'child-hidden' });
  });

  it('an unreadable doc page (different tenant) contributes nothing', async () => {
    const page = { id: { toString: () => 'page-foreign' }, tenantId: 't2', updatedAt: new Date() };
    const { uc, calls } = build({ rootIssue: issue(), docPages: [page] });
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    const [, refs] = calls[0] as [string, { entity: AuditEntity; entityId: string }[]];
    expect(refs).not.toContainEqual({ entity: AuditEntity.DOC_PAGE, entityId: 'page-foreign' });
  });

  it('caps related ids at 50 and sets relatedTruncated', async () => {
    const children = Array.from({ length: 60 }, (_, i) =>
      issue({ id: `child-${i}`, updatedAt: new Date(2026, 0, i + 1) }),
    );
    const { uc, calls } = build({ rootIssue: issue(), children });
    const result = await uc.execute(req);
    expect(result.isSuccess).toBe(true);
    const [, refs] = calls[0] as [string, { entity: AuditEntity; entityId: string }[]];
    // 50 related + 1 for the issue's own ref.
    expect(refs).toHaveLength(51);
    expect(result.getValue().relatedTruncated).toBe(true);
    // The most recently updated child (child-59) must have survived the cap.
    expect(refs).toContainEqual({ entity: AuditEntity.ISSUE, entityId: 'child-59' });
  });
});
