import { Result } from '@shared/logic/result';
import { McpUpdateDocUseCase, type McpActor } from './mcp.use-cases';
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

const fakePages = [
  { id: { toString: () => FIRST_PAGE_ID }, title: 'Discovery notes' },
  { id: { toString: () => SECOND_PAGE_ID }, title: 'Appendix' },
];

const actor: McpActor = {
  tenantId: 't1',
  keyId: 'k1',
  keyName: 'CI',
  userId: 'u1',
  scope: ApiKeyScope.READ_WRITE,
  clientName: 'claude-code/1.0',
};

const buildDeps = (over: { saveVersion?: jest.Mock } = {}) => {
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
  const useCase = new McpUpdateDocUseCase(
    getDoc as never,
    updateDoc as never,
    updatePage as never,
    createPage as never,
    saveVersion as never,
    users as never,
    events as never,
  );
  return { useCase, getDoc, updateDoc, updatePage, createPage, saveVersion, events };
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
  const STORED =
    '<h2>Week 31</h2>' +
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
