import { Result } from '@shared/logic/result';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';

/**
 * The scope gate is mocked so the test can assert the *absence* of a call. If a
 * read tool or a read route ever starts gating, the mock refuses and the test
 * fails twice over: once on `not.toHaveBeenCalled`, once on the reply.
 */
jest.mock('./mcp-scope', () => ({
  assertCanWrite: jest.fn(() => Result.fail('gated — this key is read-only')),
  assertCanDelete: jest.fn(() => Result.fail('gated — this key cannot delete')),
}));

import { McpServerFactory } from './mcp-server.factory';
import { McpController } from './mcp.controller';
import { assertCanWrite } from './mcp-scope';

const READ_ONLY_ACTOR = {
  tenantId: 't1',
  keyId: 'k1',
  keyName: 'CI',
  userId: 'u1',
  scope: ApiKeyScope.READ_ONLY,
  clientName: 'claude-code/1.0',
};

const DOC_BRIEF = {
  ref: 'DOC-3',
  id: 'doc-uuid',
  title: 'Weekly report',
  tags: ['weekly'],
  pageCount: 2,
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

const DOC_DETAIL = {
  ref: 'DOC-3',
  id: 'doc-uuid',
  title: 'Weekly report',
  tags: ['weekly'],
  pages: [
    { id: 'page-1', title: 'Week 31', parentId: '', order: 0 },
    { id: 'page-2', title: 'Appendix', parentId: 'page-1', order: 1 },
  ],
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

const DOC_PAGE = {
  id: 'page-1',
  title: 'Week 31',
  content: '<p>the body</p>',
  updatedAt: new Date('2026-08-02T00:00:00Z'),
};

/* ── The JSON-RPC tools ───────────────────────────────────────────────────── */

interface Registered {
  name: string;
  config: { annotations?: { readOnlyHint?: boolean }; description: string };
  handler: (args: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>;
}

/** Stand the factory up without its twenty-odd collaborators — only the three
 *  doc-read use-cases are reached, so only those are supplied. */
function registerDocReads(): Record<string, Registered> {
  const factory = Object.create(McpServerFactory.prototype) as McpServerFactory;
  Object.assign(factory, {
    appUrl: 'http://localhost:3001',
    listDocs: { execute: jest.fn().mockResolvedValue(Result.ok([DOC_BRIEF])) },
    getDoc: { execute: jest.fn().mockResolvedValue(Result.ok(DOC_DETAIL)) },
    getDocPage: { execute: jest.fn().mockResolvedValue(Result.ok(DOC_PAGE)) },
  });

  const registered: Record<string, Registered> = {};
  const server = {
    registerTool: (name: string, config: Registered['config'], handler: Registered['handler']) => {
      registered[name] = { name, config, handler };
    },
  };

  // The same wrapper `create()` builds, minus the client-version lookup.
  const run = async <T,>(
    call: (actor: typeof READ_ONLY_ACTOR) => Promise<Result<T>>,
    describe: (value: T) => string,
  ) => {
    const result = await call(READ_ONLY_ACTOR);
    if (result.isFailure) {
      return { isError: true, content: [{ text: result.error as string }] };
    }
    return { content: [{ text: describe(result.getValue()) }] };
  };

  const priv = factory as unknown as Record<string, (s: unknown, r: unknown) => void>;
  priv.registerListDocs.call(factory, server, run);
  priv.registerGetDoc.call(factory, server, run);
  priv.registerGetDocPage.call(factory, server, run);
  return registered;
}

describe('the doc read tools', () => {
  beforeEach(() => (assertCanWrite as jest.Mock).mockClear());

  const tools = ['list_docs', 'get_doc', 'get_doc_page'];

  it.each(tools)('%s is announced as read-only', (name) => {
    expect(registerDocReads()[name].config.annotations?.readOnlyHint).toBe(true);
  });

  it.each(tools)('%s answers a read-only key without consulting the write gate', async (name) => {
    const tool = registerDocReads()[name];
    const reply = await tool.handler({ doc: 'DOC-3', page: 'page-1' });

    expect(reply.isError).toBeFalsy();
    expect(assertCanWrite).not.toHaveBeenCalled();
  });

  it('get_doc prints the page ids and titles but never a page body', async () => {
    const reply = await registerDocReads().get_doc.handler({ doc: 'DOC-3' });
    const out = reply.content[0].text;
    expect(out).toContain('page-1');
    expect(out).toContain('Week 31');
    expect(out).toContain('Appendix');
    expect(out).not.toContain('the body');
  });

  it('get_doc_page prints the body verbatim, so it can be echoed back', async () => {
    const reply = await registerDocReads().get_doc_page.handler({ doc: 'DOC-3', page: 'page-1' });
    expect(reply.content[0].text).toContain('<p>the body</p>');
  });

  it('list_docs says what a ref looks like, since list_workspace does not mention docs', () => {
    expect(registerDocReads().list_docs.config.description).toContain('DOC-3');
  });
});

/* ── The REST mirror ──────────────────────────────────────────────────────── */

function controller() {
  const c = Object.create(McpController.prototype) as McpController;
  Object.assign(c, {
    listDocs: { execute: jest.fn().mockResolvedValue(Result.ok([DOC_BRIEF])) },
    getDoc: { execute: jest.fn().mockResolvedValue(Result.ok(DOC_DETAIL)) },
    getDocPage: { execute: jest.fn().mockResolvedValue(Result.ok(DOC_PAGE)) },
  });
  return c;
}

const req = { apiAuth: { ...READ_ONLY_ACTOR, name: 'CI' }, headers: {} } as never;

describe('the doc read routes', () => {
  beforeEach(() => (assertCanWrite as jest.Mock).mockClear());

  it('GET /mcp/docs serves a read-only key', async () => {
    await expect(controller().docs(req)).resolves.toEqual([DOC_BRIEF]);
    expect(assertCanWrite).not.toHaveBeenCalled();
  });

  it('GET /mcp/docs/:doc serves a read-only key and returns no page bodies', async () => {
    const detail = await controller().docDetail(req, 'DOC-3');
    expect(assertCanWrite).not.toHaveBeenCalled();
    for (const p of detail.pages) expect(p).not.toHaveProperty('content');
  });

  it('GET /mcp/docs/:doc/pages/:page serves a read-only key', async () => {
    await expect(controller().docPage(req, 'DOC-3', 'page-1')).resolves.toEqual(DOC_PAGE);
    expect(assertCanWrite).not.toHaveBeenCalled();
  });
});

/* ── The corrected update_doc description ─────────────────────────────────── */

describe('the update_doc description', () => {
  function updateDocDescription(): string {
    const factory = Object.create(McpServerFactory.prototype) as McpServerFactory;
    Object.assign(factory, { updateDoc: { execute: jest.fn() } });
    let config = { description: '' };
    const server = { registerTool: (_n: string, c: { description: string }) => (config = c) };
    (factory as unknown as Record<string, (s: unknown, r: unknown) => void>).registerUpdateDoc.call(
      factory,
      server,
      jest.fn(),
    );
    return config.description;
  }

  it('points at get_doc_page instead of "the doc in the app", which MCP cannot open', () => {
    const d = updateDocDescription();
    expect(d).toContain('get_doc_page');
    expect(d).not.toContain('the doc in the app');
  });

  it('states the blast radius: only the body goes, not title/attachments/links/styles', () => {
    const d = updateDocDescription();
    expect(d).toContain('Only the body is replaced');
    expect(d).toContain('attachments');
    expect(d).toContain('links');
  });
});
