import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import {
  GetDocUseCase,
  GetDocsUseCase,
} from '@application/docs/use-cases/doc.use-cases';
import { GetDocPageUseCase } from '@application/docs/use-cases/doc-page.use-cases';
import {
  McpGetDocPageUseCase,
  McpGetDocUseCase,
  McpListDocsUseCase,
  type McpActor,
} from './mcp.use-cases';

/**
 * The three MCP doc reads, exercised over the *real* docs use-cases with fake
 * repositories underneath. Mocking the use-cases would prove only that the
 * wrappers call them; the things worth pinning down here — the ref/uuid
 * resolution and the "this page belongs to this doc, in this tenant" rule — live
 * inside GetDocUseCase and GetDocPageUseCase, so those run for real.
 */

const TENANT = 't1';
const OTHER_TENANT = 't2';
const DOC_UUID = 'doc-uuid-1';
const DOC_REF = 'DOC-3';
const OTHER_DOC_UUID = 'doc-uuid-2';

const PUBLIC_TOKEN = 'sh4r3t0k3n';

const doc = {
  id: { toString: () => DOC_UUID },
  tenantId: TENANT,
  ref: DOC_REF,
  title: 'Weekly report',
  tags: ['weekly'],
  updatedAt: new Date('2026-08-01T00:00:00Z'),
  // The credential for the doc's public share link. It sits on the same entity
  // as everything the tools do return, which is exactly why it is asserted about.
  publicToken: PUBLIC_TOKEN,
};

const otherDoc = {
  id: { toString: () => OTHER_DOC_UUID },
  tenantId: TENANT,
  ref: 'DOC-4',
  title: 'Pricing',
  tags: [],
  updatedAt: new Date('2026-07-01T00:00:00Z'),
  publicToken: null,
};

const page = (over: Partial<Record<string, unknown>> = {}) => ({
  id: { toString: () => 'page-1' },
  tenantId: TENANT,
  docId: DOC_UUID,
  parentId: '',
  title: 'Week 31',
  content: '<table><tbody><tr><td>Ada</td><td>shipped</td></tr></tbody></table>',
  order: 0,
  updatedAt: new Date('2026-08-02T00:00:00Z'),
  ...over,
});

const childPage = {
  ...page(),
  id: { toString: () => 'page-2' },
  parentId: 'page-1',
  title: 'Appendix',
  content: '<p>numbers</p>',
  order: 1,
};

const actor = (scope: ApiKeyScope = ApiKeyScope.READ_ONLY): McpActor => ({
  tenantId: TENANT,
  keyId: 'k1',
  keyName: 'CI',
  userId: 'u1',
  scope,
  clientName: 'claude-code/1.0',
});

interface Fakes {
  pagesById: Record<string, unknown>;
  docPages: unknown[];
}

function build(fakes: Partial<Fakes> = {}) {
  const docPages = fakes.docPages ?? [page(), childPage];
  const pagesById: Record<string, unknown> = fakes.pagesById ?? {
    'page-1': page(),
    'page-2': childPage,
  };

  const docRepo = {
    findByTenant: jest.fn(async (tenantId: string) =>
      [doc, otherDoc].filter((d) => d.tenantId === tenantId),
    ),
    // The real repository accepts either form; the fake mirrors that so the
    // "DOC-3 and the uuid both resolve" test means something.
    findByIdOrRef: jest.fn(async (tenantId: string, id: string) =>
      [doc, otherDoc].find((d) => d.tenantId === tenantId && (d.ref === id || d.id.toString() === id)),
    ),
  };
  const pageRepo = {
    countByDocIds: jest.fn(async () => ({ [DOC_UUID]: 2, [OTHER_DOC_UUID]: 1 })),
    findByDoc: jest.fn(async (docId: string) => (docId === DOC_UUID ? docPages : [])),
    findById: jest.fn(async (pageId: string) => pagesById[pageId]),
  };

  const getDocs = new GetDocsUseCase(docRepo as never, pageRepo as never);
  const getDoc = new GetDocUseCase(docRepo as never, pageRepo as never);
  const getPage = new GetDocPageUseCase(pageRepo as never);

  return {
    listDocs: new McpListDocsUseCase(getDocs),
    getDoc: new McpGetDocUseCase(getDoc),
    getDocPage: new McpGetDocPageUseCase(getDoc, getPage),
  };
}

describe('list_docs', () => {
  it('lists every doc with its ref, tags and page count — no bodies', async () => {
    const { listDocs } = build();
    const result = await listDocs.execute({ actor: actor() });

    expect(result.isSuccess).toBe(true);
    const docs = result.getValue();
    expect(docs).toHaveLength(2);
    expect(docs[0]).toEqual({
      ref: DOC_REF,
      id: DOC_UUID,
      title: 'Weekly report',
      tags: ['weekly'],
      pageCount: 2,
      updatedAt: doc.updatedAt,
    });
  });

  it('succeeds on a read-only key', async () => {
    const { listDocs } = build();
    const result = await listDocs.execute({ actor: actor(ApiKeyScope.READ_ONLY) });
    expect(result.isSuccess).toBe(true);
  });

  it('never carries publicToken', async () => {
    const { listDocs } = build();
    const json = JSON.stringify((await listDocs.execute({ actor: actor() })).getValue());
    expect(json).not.toContain(PUBLIC_TOKEN);
    expect(json).not.toContain('publicToken');
  });
});

describe('get_doc', () => {
  it('returns NO page content for any page — the split between the two tools', async () => {
    const { getDoc } = build();
    const result = await getDoc.execute({ actor: actor(), dto: { doc: DOC_REF } });

    expect(result.isSuccess).toBe(true);
    const detail = result.getValue();
    expect(detail.pages).toHaveLength(2);
    for (const p of detail.pages) {
      expect(p).not.toHaveProperty('content');
    }
    // Belt and braces: the body's distinctive text must not reach the reply by
    // any other field either.
    expect(JSON.stringify(detail)).not.toContain('shipped');
  });

  it('keeps the tree and the sequence via parentId and order', async () => {
    const { getDoc } = build();
    const detail = (await getDoc.execute({ actor: actor(), dto: { doc: DOC_REF } })).getValue();
    expect(detail.pages).toEqual([
      { id: 'page-1', title: 'Week 31', parentId: '', order: 0 },
      { id: 'page-2', title: 'Appendix', parentId: 'page-1', order: 1 },
    ]);
  });

  it('resolves the DOC-… ref and the uuid to the same doc', async () => {
    const { getDoc } = build();
    const byRef = (await getDoc.execute({ actor: actor(), dto: { doc: DOC_REF } })).getValue();
    const byId = (await getDoc.execute({ actor: actor(), dto: { doc: DOC_UUID } })).getValue();
    expect(byRef).toEqual(byId);
    expect(byRef.ref).toBe(DOC_REF);
    expect(byRef.id).toBe(DOC_UUID);
  });

  it('refuses a doc from another tenant', async () => {
    const { getDoc } = build();
    const result = await getDoc.execute({
      actor: { ...actor(), tenantId: OTHER_TENANT },
      dto: { doc: DOC_REF },
    });
    expect(result.isFailure).toBe(true);
  });

  it('succeeds on a read-only key', async () => {
    const { getDoc } = build();
    const result = await getDoc.execute({
      actor: actor(ApiKeyScope.READ_ONLY),
      dto: { doc: DOC_REF },
    });
    expect(result.isSuccess).toBe(true);
  });

  it('never carries publicToken', async () => {
    const { getDoc } = build();
    const json = JSON.stringify((await getDoc.execute({ actor: actor(), dto: { doc: DOC_REF } })).getValue());
    expect(json).not.toContain(PUBLIC_TOKEN);
    expect(json).not.toContain('publicToken');
  });
});

describe('get_doc_page', () => {
  it('returns the page body as stored', async () => {
    const { getDocPage } = build();
    const result = await getDocPage.execute({
      actor: actor(),
      dto: { doc: DOC_REF, page: 'page-1' },
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue()).toEqual({
      id: 'page-1',
      title: 'Week 31',
      content: page().content,
      updatedAt: page().updatedAt,
    });
  });

  it('refuses a page id that belongs to a different doc', async () => {
    const { getDocPage } = build({
      pagesById: { 'page-9': page({ id: { toString: () => 'page-9' }, docId: OTHER_DOC_UUID }) },
    });
    const result = await getDocPage.execute({
      actor: actor(),
      dto: { doc: DOC_REF, page: 'page-9' },
    });
    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Page not found');
  });

  it('refuses a page from another tenant', async () => {
    const { getDocPage } = build({
      pagesById: { 'page-1': page({ tenantId: OTHER_TENANT }) },
    });
    const result = await getDocPage.execute({
      actor: actor(),
      dto: { doc: DOC_REF, page: 'page-1' },
    });
    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Page not found');
  });

  it('resolves the doc by ref or by uuid before finding the page', async () => {
    const { getDocPage } = build();
    const byRef = await getDocPage.execute({ actor: actor(), dto: { doc: DOC_REF, page: 'page-1' } });
    const byId = await getDocPage.execute({ actor: actor(), dto: { doc: DOC_UUID, page: 'page-1' } });
    expect(byRef.getValue()).toEqual(byId.getValue());
  });

  it('succeeds on a read-only key', async () => {
    const { getDocPage } = build();
    const result = await getDocPage.execute({
      actor: actor(ApiKeyScope.READ_ONLY),
      dto: { doc: DOC_REF, page: 'page-1' },
    });
    expect(result.isSuccess).toBe(true);
  });

  it('never carries publicToken', async () => {
    const { getDocPage } = build();
    const json = JSON.stringify(
      (await getDocPage.execute({ actor: actor(), dto: { doc: DOC_REF, page: 'page-1' } })).getValue(),
    );
    expect(json).not.toContain(PUBLIC_TOKEN);
    expect(json).not.toContain('publicToken');
  });
});
