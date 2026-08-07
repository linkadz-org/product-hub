import { Result } from '@shared/logic/result';
import { McpCreateDocUseCase, McpUpdateDocUseCase, type McpActor } from './mcp.use-cases';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';

/**
 * Pure unit test for the MCP update-doc wrapper. Every collaborator is a
 * hand-rolled mock — no Nest container — so the two behaviours the spec pins down
 * are exercised on their own: the doc-level title/tags path delegates to
 * UpdateDocUseCase, and the content path converts the body and edits the doc's
 * FIRST page when `page` is omitted.
 */

const DOC_REF = 'DOC-ABC';
const DOC_UUID = 'uuid-of-doc';
const FIRST_PAGE_ID = 'page-1';
const SECOND_PAGE_ID = 'page-2';

const fakeDoc = {
  id: { toString: () => DOC_UUID },
  title: 'Discovery notes',
  tags: ['discovery'],
};

// `content` matters: the use-case compares the incoming body against the stored
// one to skip a pointless snapshot, and the *title* of the first page equals the
// doc's — which is the ordinary shape (a doc's first page is named after it) and
// exactly the case where a title-stripping write-back would shave the heading.
const fakePages = [
  { id: { toString: () => FIRST_PAGE_ID }, title: 'Discovery notes', content: '<p>old</p>' },
  { id: { toString: () => SECOND_PAGE_ID }, title: 'Appendix', content: '<p>old</p>' },
];

const actor: McpActor = {
  tenantId: 't1',
  keyId: 'k1',
  keyName: 'CI',
  userId: 'u1',
  scope: ApiKeyScope.READ_WRITE,
  clientName: 'claude-code/1.0',
};

const buildDeps = (over: { saveVersion?: jest.Mock; collabReset?: jest.Mock } = {}) => {
  const getDoc = {
    execute: jest.fn().mockResolvedValue(Result.ok({ doc: fakeDoc, pages: fakePages })),
  };
  const updateDoc = { execute: jest.fn().mockResolvedValue(Result.ok(fakeDoc)) };
  const updatePage = {
    execute: jest.fn().mockResolvedValue(Result.ok({ id: { toString: () => FIRST_PAGE_ID } })),
  };
  const createPage = {
    execute: jest.fn().mockResolvedValue(Result.ok({ id: { toString: () => SECOND_PAGE_ID } })),
  };
  const saveVersion = {
    execute: over.saveVersion ?? jest.fn().mockResolvedValue(Result.ok({ id: 'v1' })),
  };
  const users = { findById: jest.fn().mockResolvedValue({ name: 'Ada' }) };
  const events = { append: jest.fn().mockResolvedValue(undefined) };
  // Default: collab is configured and the room took the refresh. The port never
  // rejects — a refresh problem is reported, not thrown — so the mock resolves
  // in every case too.
  const collab = {
    resetPage: over.collabReset ?? jest.fn().mockResolvedValue({ status: 'refreshed' }),
  };
  const useCase = new McpUpdateDocUseCase(
    getDoc as never,
    updateDoc as never,
    updatePage as never,
    createPage as never,
    saveVersion as never,
    collab as never,
    users as never,
    events as never,
  );
  return { useCase, getDoc, updateDoc, updatePage, createPage, saveVersion, collab, events };
};

describe('McpUpdateDocUseCase', () => {
  it('renames/retags via UpdateDocUseCase without touching any page', async () => {
    const { useCase, updateDoc, updatePage, createPage } = buildDeps();

    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, title: 'New title', tags: ['q3', 'spec'] },
    });

    expect(result.isSuccess).toBe(true);
    expect(updateDoc.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        id: DOC_UUID,
        tenantId: 't1',
        dto: { title: 'New title', tags: ['q3', 'spec'] },
      }),
    );
    // Doc-level only — no page write of either kind.
    expect(updatePage.execute).not.toHaveBeenCalled();
    expect(createPage.execute).not.toHaveBeenCalled();
    expect(result.getValue().changed).toContain('renamed');
    expect(result.getValue().changed).toContain('retagged');
  });

  it('converts the body and edits the FIRST page when `page` is omitted', async () => {
    const { useCase, updateDoc, updatePage } = buildDeps();

    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, content: '## Findings\n\n- one\n- two' },
    });

    expect(result.isSuccess).toBe(true);
    // No doc-level metadata change requested.
    expect(updateDoc.execute).not.toHaveBeenCalled();
    // The first page is the target, and the Markdown became HTML tags.
    expect(updatePage.execute).toHaveBeenCalledTimes(1);
    const arg = updatePage.execute.mock.calls[0][0];
    expect(arg).toEqual(
      expect.objectContaining({ docId: DOC_UUID, pageId: FIRST_PAGE_ID, tenantId: 't1' }),
    );
    expect(arg.dto.content).toContain('<h2>Findings</h2>');
    expect(arg.dto.content).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(result.getValue().changed).toContain('edited a page');
  });

  it('edits the named page when `page` is supplied', async () => {
    const { useCase, updatePage } = buildDeps();

    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, page: SECOND_PAGE_ID, content: 'Just text' },
    });

    expect(result.isSuccess).toBe(true);
    expect(updatePage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: SECOND_PAGE_ID }),
    );
  });

  it('rejects a call that changes nothing', async () => {
    const { useCase } = buildDeps();
    const result = await useCase.execute({ actor, dto: { doc: DOC_REF } });
    expect(result.isFailure).toBe(true);
  });
});

/**
 * The safety net. `update_doc` replaces a page's whole body in one shot with no
 * undo, so the page as it stands is frozen into its version history first —
 * which is only true if the snapshot happens BEFORE the write and a failed
 * snapshot stops the write from happening at all.
 */
describe('McpUpdateDocUseCase — snapshot before overwrite', () => {
  it('saves a version of the target page before writing the body', async () => {
    const { useCase, saveVersion, updatePage } = buildDeps();

    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, page: SECOND_PAGE_ID, content: 'New text' },
    });

    expect(result.isSuccess).toBe(true);
    expect(saveVersion.execute).toHaveBeenCalledTimes(1);
    expect(saveVersion.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: DOC_UUID,
        pageId: SECOND_PAGE_ID,
        tenantId: 't1',
        author: { userId: 'u1', name: 'Ada' },
      }),
    );
    // Order is the whole point: SaveDocPageVersionUseCase snapshots the page as
    // it currently is, so running it after the write would freeze the new body.
    const snapshotAt = saveVersion.execute.mock.invocationCallOrder[0];
    const writeAt = updatePage.execute.mock.invocationCallOrder[0];
    expect(snapshotAt).toBeLessThan(writeAt);
  });

  it('labels the version so it is distinguishable from a human "save version"', async () => {
    const { useCase, saveVersion } = buildDeps();
    await useCase.execute({ actor, dto: { doc: DOC_REF, content: 'New text' } });
    const label = saveVersion.execute.mock.calls[0][0].dto.label as string;
    expect(label).toBeTruthy();
    expect(label.toLowerCase()).toContain('update_doc');
  });

  it('does NOT snapshot a title/tags-only edit — no body is written', async () => {
    const { useCase, saveVersion } = buildDeps();
    const result = await useCase.execute({ actor, dto: { doc: DOC_REF, title: 'Renamed' } });
    expect(result.isSuccess).toBe(true);
    expect(saveVersion.execute).not.toHaveBeenCalled();
  });

  it('does NOT snapshot appendPage — a new page has no previous body to lose', async () => {
    const { useCase, saveVersion } = buildDeps();
    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, appendPage: { title: 'Appendix B', content: 'text' } },
    });
    expect(result.isSuccess).toBe(true);
    expect(saveVersion.execute).not.toHaveBeenCalled();
  });

  it('aborts the write when the snapshot fails — the body is not overwritten', async () => {
    const { useCase, updatePage, saveVersion } = buildDeps({
      saveVersion: jest.fn().mockResolvedValue(Result.fail('versions unavailable')),
    });

    const result = await useCase.execute({ actor, dto: { doc: DOC_REF, content: 'New text' } });

    expect(saveVersion.execute).toHaveBeenCalledTimes(1);
    expect(result.isFailure).toBe(true);
    // Writing anyway would remove the recoverability guarantee at exactly the
    // moment it was needed.
    expect(updatePage.execute).not.toHaveBeenCalled();
  });

  it('says why it refused, rather than reporting a silent success', async () => {
    const { useCase } = buildDeps({
      saveVersion: jest.fn().mockResolvedValue(Result.fail('versions unavailable')),
    });
    const result = await useCase.execute({ actor, dto: { doc: DOC_REF, content: 'New text' } });
    expect(result.error).toContain('versions unavailable');
    expect(result.error).toContain('not applied');
  });
});

/**
 * Round trip. `get_doc_page` hands back the stored HTML and `update_doc` runs it
 * through `docBodyToHtml` + `stripEchoedTitle` on the way back in. If either
 * step is not a no-op on already-stored HTML, a read-modify-write loop degrades
 * the page a little on every pass — tables reformatted, a diagram demoted to a
 * code block, the leading heading shaved.
 */
describe('McpUpdateDocUseCase — read → write-back is byte-identical', () => {
  // The opening heading is the target page's own title on purpose. With any
  // other text the title-strip branch never runs and this suite quietly proves
  // nothing about the risk its name claims to cover — which is what it did while
  // the heading read "Week 31" and the page was called "Discovery notes".
  const STORED =
    '<h2>Discovery notes</h2>' +
    '<p>Notes with <b>bold</b>, a <a href="https://x.test">link</a> and a pipe | character.</p>' +
    '<table><thead><tr><th>Who</th><th>Status</th></tr></thead>' +
    '<tbody><tr><td>Ada</td><td>shipped</td></tr><tr><td>Linh</td><td>blocked</td></tr></tbody></table>' +
    '<img src="https://x.test/a.png"/>' +
    '<figure class="mermaid-block"><pre class="mermaid-source"><code>flowchart TD\n  A --&gt; B</code></pre></figure>' +
    '<ul><li>one</li><li>two</li></ul>';

  it('stores exactly what get_doc_page returned', async () => {
    const { useCase, updatePage } = buildDeps();

    // What get_doc_page would have handed the assistant, echoed straight back.
    const result = await useCase.execute({ actor, dto: { doc: DOC_REF, content: STORED } });

    expect(result.isSuccess).toBe(true);
    expect(updatePage.execute.mock.calls[0][0].dto.content).toBe(STORED);
  });

  it('is stable across a second pass', async () => {
    const { useCase, updatePage } = buildDeps();
    await useCase.execute({ actor, dto: { doc: DOC_REF, content: STORED } });
    const first = updatePage.execute.mock.calls[0][0].dto.content as string;
    await useCase.execute({ actor, dto: { doc: DOC_REF, content: first } });
    expect(updatePage.execute.mock.calls[1][0].dto.content).toBe(first);
  });
});

/**
 * The title echo, and who it applies to.
 *
 * `stripEchoedTitle` exists because an assistant asked for a doc called X opens
 * with "# X", and the page already prints its title above the body. That is true
 * of content being *composed* — and false of content being *replaced*: a page's
 * body very often opens on a heading of its own name (a doc's first page shares
 * the doc's title), so shaving it on write-back deletes a real heading a person
 * typed, once per edit, until it is gone.
 *
 * So: compose strips, replace does not.
 */
describe('McpUpdateDocUseCase — a replaced body keeps its leading heading', () => {
  const ECHOES_TITLE = '<h2>Discovery notes</h2><p>Body.</p>';

  it('update_doc preserves a heading that matches the page title', async () => {
    const { useCase, updatePage } = buildDeps();

    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, page: FIRST_PAGE_ID, content: ECHOES_TITLE },
    });

    expect(result.isSuccess).toBe(true);
    expect(updatePage.execute.mock.calls[0][0].dto.content).toBe(ECHOES_TITLE);
  });

  it('does not shave a little more off on each successive write-back', async () => {
    const { useCase, updatePage } = buildDeps();
    // Three passes of read → edit nothing → write. Under the old rule the first
    // pass drops the heading and the page is permanently one heading shorter.
    let body = ECHOES_TITLE;
    for (let pass = 0; pass < 3; pass++) {
      await useCase.execute({ actor, dto: { doc: DOC_REF, page: FIRST_PAGE_ID, content: body } });
      body = updatePage.execute.mock.calls[pass][0].dto.content as string;
    }
    expect(body).toBe(ECHOES_TITLE);
  });

  it('appendPage still strips it — a brand-new page is composed, not replaced', async () => {
    const { useCase, createPage } = buildDeps();

    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, appendPage: { title: 'Appendix B', content: '<h2>Appendix B</h2><p>Body.</p>' } },
    });

    expect(result.isSuccess).toBe(true);
    expect(createPage.execute.mock.calls[0][0].dto.content).toBe('<p>Body.</p>');
  });
});

describe('McpCreateDocUseCase — composed content still strips the echoed title', () => {
  it('drops an opening heading that repeats the doc title', async () => {
    const createDoc = {
      execute: jest.fn().mockResolvedValue(
        Result.ok({
          doc: { id: { toString: () => DOC_UUID }, ref: DOC_REF, title: 'Discovery notes', tags: [] },
          pages: [{ id: { toString: () => FIRST_PAGE_ID } }],
        }),
      ),
    };
    const updatePage = { execute: jest.fn().mockResolvedValue(Result.ok({})) };
    const useCase = new McpCreateDocUseCase(
      createDoc as never,
      updatePage as never,
      { findById: jest.fn().mockResolvedValue({ name: 'Ada' }) } as never,
      { append: jest.fn().mockResolvedValue(undefined) } as never,
    );

    const result = await useCase.execute({
      actor,
      dto: { title: 'Discovery notes', content: '<h2>Discovery notes</h2><p>Body.</p>' },
    });

    expect(result.isSuccess).toBe(true);
    expect(updatePage.execute.mock.calls[0][0].dto.content).toBe('<p>Body.</p>');
  });
});

/**
 * Reaching the live editing session.
 *
 * `update_doc` writes `docpages.content`, but while anyone has the page open the
 * Y.Doc in the collab room is the copy they are looking at, and the mirror writes
 * that back over the column on store. A write that skipped the room reports
 * success and is then silently reverted by the next keystroke — so the room is
 * asked to re-read the stored body, and if it can't be, the caller is told.
 */
describe('McpUpdateDocUseCase — refreshing the live editing session', () => {
  it('refreshes the room after a body write, naming the page it wrote', async () => {
    const { useCase, collab, updatePage } = buildDeps();

    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, page: SECOND_PAGE_ID, content: 'New text' },
    });

    expect(result.isSuccess).toBe(true);
    expect(collab.resetPage).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', pageId: SECOND_PAGE_ID, userId: 'u1' }),
    );
    // After the write: refreshing the room from the stored body before the body
    // is stored would push the OLD text at every open editor.
    expect(collab.resetPage.mock.invocationCallOrder[0]).toBeGreaterThan(
      updatePage.execute.mock.invocationCallOrder[0],
    );
    expect(result.getValue().warning).toBe('');
  });

  it('does not refresh a title/tags-only edit — no body changed', async () => {
    const { useCase, collab } = buildDeps();
    const result = await useCase.execute({ actor, dto: { doc: DOC_REF, title: 'Renamed' } });
    expect(result.isSuccess).toBe(true);
    expect(collab.resetPage).not.toHaveBeenCalled();
  });

  it('is a clean no-op when no collab server is configured', async () => {
    const { useCase } = buildDeps({
      collabReset: jest.fn().mockResolvedValue({ status: 'not-configured' }),
    });

    const result = await useCase.execute({ actor, dto: { doc: DOC_REF, content: 'New text' } });

    // A deployment that doesn't run collab has no room to refresh and nothing to
    // warn about — the write is plainly successful.
    expect(result.isSuccess).toBe(true);
    expect(result.getValue().warning).toBe('');
    expect(result.getValue().changed).toContain('edited a page');
  });

  it('reports a failed refresh without failing the write', async () => {
    const { useCase, updatePage } = buildDeps({
      collabReset: jest
        .fn()
        .mockResolvedValue({ status: 'failed', error: 'collab server answered 502' }),
    });

    const result = await useCase.execute({ actor, dto: { doc: DOC_REF, content: 'New text' } });

    // The write committed — rolling it back is not on offer and pretending it
    // didn't happen would be a second lie.
    expect(result.isSuccess).toBe(true);
    expect(updatePage.execute).toHaveBeenCalledTimes(1);
    expect(result.getValue().changed).toContain('edited a page');
    // ...but the caller has to be able to act on it, so the cause and the
    // consequence are both spelled out.
    const { warning } = result.getValue();
    expect(warning).toContain('502');
    expect(warning.toLowerCase()).toContain('saved');
    expect(warning.toLowerCase()).toContain('write it back over');
  });
});

/**
 * Version history is not free. Each `update_doc` snapshot is a full copy of the
 * page body, so an assistant iterating on a 300 KB page would otherwise leave one
 * behind per pass — including the passes that changed nothing at all.
 */
describe('McpUpdateDocUseCase — no snapshot for a write that changes nothing', () => {
  it('skips the version and the write when the body already matches', async () => {
    const { useCase, saveVersion, updatePage, collab } = buildDeps();

    // `fakePages[0].content` is exactly this.
    const result = await useCase.execute({
      actor,
      dto: { doc: DOC_REF, page: FIRST_PAGE_ID, content: '<p>old</p>' },
    });

    expect(result.isSuccess).toBe(true);
    expect(saveVersion.execute).not.toHaveBeenCalled();
    expect(updatePage.execute).not.toHaveBeenCalled();
    // Nothing was written, so no room needs refreshing either.
    expect(collab.resetPage).not.toHaveBeenCalled();
    // And it says so rather than claiming an edit it did not make.
    expect(result.getValue().changed).toContain('already matched');
  });

  it('caps how many of its own snapshots one page keeps', async () => {
    const { useCase, saveVersion } = buildDeps();
    await useCase.execute({ actor, dto: { doc: DOC_REF, content: 'New text' } });
    // Retention is label-scoped inside SaveDocPageVersionUseCase, so this can
    // only ever prune MCP's own snapshots — never a version a person saved.
    const call = saveVersion.execute.mock.calls[0][0];
    expect(typeof call.retain).toBe('number');
    expect(call.retain).toBeGreaterThan(0);
  });
});
