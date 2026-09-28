// The table half of the Editor.js ⇄ Yjs binding, against a real DOM.
//
// `collab`'s `npm run smoke` proves the *shape* merges and `npm run verify` proves
// it survives the real server, but both run headless: neither has ever executed
// `editorjsBinding.ts`, which is where a table is read out of the DOM and written
// back into it. That is also where the two bugs behind the weekly report lived —
// the whole-table write that lost cells, and the whole-table re-render that threw
// away the caret — so it is the half most worth pinning down.
//
// Editor.js is faked, deliberately and narrowly. What matters is that the fake
// reproduces the two behaviours of the real thing that the binding has to work
// around, both verified against the tool's source:
//
//   · `getData()` reads `.tc-cell` innerHTML and **drops rows that are entirely
//     empty** — so a row somebody just added is missing from `save()`.
//   · `blocks.update()` re-renders the block, taking its DOM nodes with it.
//
// Assertions avoid the Selection API and check something stronger instead: that a
// cell nobody edited is still the *same DOM node* afterwards, and still holds the
// same Y.Text *instance*. A caret cannot survive a node being replaced, and it
// does not need to survive anything else.
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  blocksOf,
  cellsOf,
  readGrid,
  rowsOf,
  toYBlock,
  type StoredBlock,
  type YBlocks,
} from './blockDoc';
import { bindEditorJs } from './editorjsBinding';

// ── a narrow Editor.js ──────────────────────────────────────────────────────

interface FakeBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
  el: HTMLElement;
}

const rowsIn = (el: HTMLElement): HTMLElement[] =>
  Array.from(el.querySelectorAll<HTMLElement>('.tc-table > .tc-row'));
const cellsIn = (row: HTMLElement): HTMLElement[] =>
  Array.from(row.querySelectorAll<HTMLElement>(':scope > .tc-cell'));

/** The markup the table tool renders, down to the class names the binding reads. */
function fill(el: HTMLElement, type: string, data: Record<string, unknown>): void {
  el.replaceChildren();
  if (type !== 'table') {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    editable.innerHTML = String(data['text'] ?? '');
    el.append(editable);
    return;
  }
  const table = document.createElement('div');
  table.className = 'tc-table';
  const heights = (data['rowHeights'] as number[] | undefined) ?? [];
  ((data['content'] as string[][] | undefined) ?? []).forEach((line, r) => {
    const row = document.createElement('div');
    row.className = 'tc-row';
    if (heights[r]) row.style.minHeight = `${heights[r]}px`;
    for (const cell of line) {
      const td = document.createElement('div');
      td.className = 'tc-cell';
      td.setAttribute('contenteditable', 'true');
      td.innerHTML = cell;
      row.append(td);
    }
    table.append(row);
  });
  const wrap = document.createElement('div');
  wrap.className = 'tc-wrap';
  wrap.append(table);
  el.append(wrap);
}

/**
 * What the tool would save. The empty-row filter is the real one's, and the reason
 * the binding never reads a table from here.
 */
function saveOf(block: FakeBlock): Record<string, unknown> {
  if (block.type !== 'table') {
    const editable = block.el.querySelector<HTMLElement>('[contenteditable="true"]');
    return { ...block.data, text: editable?.innerHTML ?? '' };
  }
  const content: string[][] = [];
  const heights: number[] = [];
  for (const row of rowsIn(block.el)) {
    const cells = cellsIn(row);
    if (cells.length && cells.every((cell) => !cell.textContent?.trim())) continue;
    content.push(cells.map((cell) => cell.innerHTML));
    heights.push(Math.round(Number.parseFloat(row.style.minHeight) || 0));
  }
  const data: Record<string, unknown> = { ...block.data, content };
  if (heights.some((h) => h > 0)) data['rowHeights'] = heights;
  else delete data['rowHeights'];
  return data;
}

class FakeEditor {
  readonly holder = document.createElement('div');
  readonly isReady = Promise.resolve();
  /** Whole-block re-renders — the caret-losing path, counted so tests can forbid it. */
  rerenders = 0;
  private list: FakeBlock[] = [];

  constructor(initial: StoredBlock[]) {
    // In the document, not detached: the binding checks `isConnected` before it
    // trusts a composition, and a caret only means something inside a document.
    document.body.append(this.holder);
    for (const block of initial) this.add(block, this.list.length);
  }

  private add(block: StoredBlock, at: number): FakeBlock {
    const el = document.createElement('div');
    el.className = 'ce-block';
    fill(el, block.type, block.data);
    const entry: FakeBlock = { id: block.id, type: block.type, data: { ...block.data }, el };
    this.list.splice(at, 0, entry);
    this.holder.insertBefore(el, this.holder.children[at] ?? null);
    return entry;
  }

  private handleFor(block: FakeBlock | undefined) {
    if (!block) return undefined;
    return {
      id: block.id,
      name: block.type,
      holder: block.el,
      save: async () => ({ data: saveOf(block) }),
    };
  }

  readonly blocks = {
    getBlocksCount: () => this.list.length,
    getBlockByIndex: (i: number) => this.handleFor(this.list[i]),
    getBlockByElement: (el: HTMLElement) =>
      this.handleFor(this.list.find((block) => block.el.contains(el))),
    getCurrentBlockIndex: () => -1,
    insert: (
      type: string,
      data: Record<string, unknown>,
      _config: unknown,
      index: number,
      _focus?: boolean,
      _replace?: boolean,
      id?: string,
    ) => {
      this.add({ id: id ?? `gen-${this.list.length}`, type, data }, index);
    },
    delete: (index: number) => {
      const [gone] = this.list.splice(index, 1);
      gone?.el.remove();
    },
    move: (to: number, from: number) => {
      const [moved] = this.list.splice(from, 1);
      if (!moved) return;
      this.list.splice(to, 0, moved);
      this.holder.insertBefore(moved.el, this.holder.children[to] ?? null);
    },
    update: async (id: string, data: Record<string, unknown>) => {
      const block = this.list.find((entry) => entry.id === id);
      if (!block) return;
      this.rerenders += 1;
      block.data = { ...data };
      fill(block.el, block.type, block.data);
    },
    render: async ({ blocks }: { blocks: StoredBlock[] }) => {
      this.rerenders += 1;
      this.holder.replaceChildren();
      this.list = [];
      for (const block of blocks) this.add(block, this.list.length);
    },
  };

  save = async () => ({
    blocks: this.list.map((block) => ({ id: block.id, type: block.type, data: saveOf(block) })),
  });

  /** The table block's rendered rows, the way the binding finds them. */
  rows(index = 0): HTMLElement[] {
    return rowsIn(this.list[index]!.el);
  }
  cell(row: number, col: number, index = 0): HTMLElement {
    return cellsIn(this.rows(index)[row]!)[col]!;
  }
}

// ── harness ─────────────────────────────────────────────────────────────────

/** Types into a cell the way a person does: change the DOM, then let it bubble. */
function type(el: HTMLElement, html: string): void {
  el.innerHTML = html;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Put the caret at the end of an editable — where a composition starts from. */
function caretToEnd(el: HTMLElement): void {
  el.focus();
  const selection = window.getSelection();
  if (!selection) throw new Error('no Selection: the caret tests cannot mean anything');
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The binding's queue is promise-based; let it drain. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

const TABLE: StoredBlock = {
  id: 'weekly',
  type: 'table',
  data: {
    withHeadings: true,
    content: [
      ['Who', 'This week'],
      ['@Grace', 'Testing Sign Up'],
      ['@Theo', 'Plan for new members'],
    ],
  },
};

interface Harness {
  editor: FakeEditor;
  blocks: YBlocks;
  doc: Y.Doc;
  binding: ReturnType<typeof bindEditorJs>;
}

/** One editor, bound to a document already holding `initial`. */
function mount(initial: StoredBlock[] = [TABLE]): Harness {
  const doc = new Y.Doc();
  const blocks = blocksOf(doc);
  blocks.insert(0, initial.map(toYBlock));
  const editor = new FakeEditor(initial);
  const binding = bindEditorJs({
    editor: editor as unknown as Parameters<typeof bindEditorJs>[0]['editor'],
    blocks,
    holder: editor.holder,
  });
  return { editor, blocks, doc, binding };
}

/** Somebody else's window: a second document, synced both ways on demand. */
function peer(doc: Y.Doc): { doc: Y.Doc; blocks: YBlocks; sync: () => void } {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  return {
    doc: other,
    blocks: blocksOf(other),
    sync: () => {
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
      Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other)));
    },
  };
}

const grid = (blocks: YBlocks, index = 0): string[][] => readGrid(rowsOf(blocks.get(index))!).content;
const cellOf = (blocks: YBlocks, row: number, col: number): Y.Text =>
  cellsOf(rowsOf(blocks.get(0))!.get(row))!.get(col) as Y.Text;

// ── the tests ───────────────────────────────────────────────────────────────

describe('a table in the collaborative editor', () => {
  let h: Harness;

  beforeEach(async () => {
    document.body.replaceChildren();
    h = mount();
    await settle();
  });

  it('names every rendered row with the id the document knows it by', () => {
    const ids = rowsOf(h.blocks.get(0))!.map((row) => String(row.get('id')));
    expect(h.editor.rows().map((el) => el.dataset['yrow'])).toEqual(ids);
  });

  it('sends a keystroke as an edit to one cell, leaving the others untouched', async () => {
    const otherRow = cellOf(h.blocks, 2, 1);
    type(h.editor.cell(1, 1), 'Testing Sign Up, Sign In');

    expect(cellOf(h.blocks, 1, 1).toString()).toBe('Testing Sign Up, Sign In');
    // Not merely equal text — the same Y.Text. A rewritten cell is a cell whose
    // caret everyone else just lost, and whose concurrent edits went with it.
    expect(cellOf(h.blocks, 2, 1)).toBe(otherRow);
    expect(otherRow.toString()).toBe('Plan for new members');
  });

  it("keeps both people's text when they type in the same table at once", async () => {
    const away = peer(h.doc);

    // Neither has seen the other yet — the weekly report, exactly.
    type(h.editor.cell(1, 1), 'Testing Sign Up, Sign In, Home');
    (cellsOf(rowsOf(away.blocks.get(0))!.get(2))!.get(0) as Y.Text).insert(5, ' (BE)');
    away.sync();
    await settle();

    expect(grid(h.blocks)[1]![1]).toBe('Testing Sign Up, Sign In, Home');
    expect(grid(h.blocks)[2]![0]).toBe('@Theo (BE)');
    expect(grid(away.blocks)).toEqual(grid(h.blocks));
  });

  it("writes somebody else's cell into the DOM without re-rendering the table", async () => {
    const away = peer(h.doc);
    const mine = h.editor.cell(1, 1);
    const rerendersBefore = h.editor.rerenders;

    (cellsOf(rowsOf(away.blocks.get(0))!.get(2))!.get(1) as Y.Text).insert(0, 'Re-plan: ');
    away.sync();
    await settle();

    expect(h.editor.cell(2, 1).innerHTML).toBe('Re-plan: Plan for new members');
    // The two things a caret needs: the cell it sits in is the same node, and the
    // block was never re-rendered around it.
    expect(h.editor.cell(1, 1)).toBe(mine);
    expect(h.editor.rerenders).toBe(rerendersBefore);
  });

  it('publishes a row added in the editor even while it is still empty', async () => {
    // The row the table tool's own `save()` leaves out. Before the grid shape this
    // was unreachable: an empty row simply did not exist for anybody else.
    const table = h.editor.rows()[0]!.parentElement!;
    const blank = document.createElement('div');
    blank.className = 'tc-row';
    for (let i = 0; i < 2; i += 1) {
      const cell = document.createElement('div');
      cell.className = 'tc-cell';
      cell.setAttribute('contenteditable', 'true');
      blank.append(cell);
    }
    table.append(blank);

    // A toolbox insert reaches the binding as the editor's change event, not as
    // an `input` — the tool typed nothing.
    h.binding.pull();
    await settle();

    expect(rowsOf(h.blocks.get(0))!.length).toBe(4);
    expect(grid(h.blocks)[3]).toEqual(['', '']);
    expect((await h.editor.save()).blocks[0]!.data['content']).toHaveLength(3);
  });

  it('inserts a row in the middle without rewriting the rows around it', async () => {
    const above = cellOf(h.blocks, 1, 0);
    const below = cellOf(h.blocks, 2, 0);

    const rows = h.editor.rows();
    const added = rows[1]!.cloneNode(true) as HTMLElement;
    delete added.dataset['yrow'];
    cellsIn(added).forEach((cell, i) => (cell.innerHTML = i === 0 ? '@Kevin' : 'Resolve 6 issues'));
    rows[1]!.after(added);

    h.binding.pull();
    await settle();

    expect(grid(h.blocks).map((line) => line[0])).toEqual(['Who', '@Grace', '@Kevin', '@Theo']);
    expect(cellOf(h.blocks, 1, 0)).toBe(above);
    expect(cellOf(h.blocks, 3, 0)).toBe(below);
  });

  it('holds a remote edit back from a cell an IME is composing in', async () => {
    const away = peer(h.doc);
    const cell = h.editor.cell(1, 1);
    // The space is an ordinary keystroke; the word after it is the composition.
    type(cell, 'Testing Sign Up ');
    caretToEnd(cell);
    cell.dispatchEvent(new Event('compositionstart', { bubbles: true }));

    (cellsOf(rowsOf(away.blocks.get(0))!.get(1))!.get(1) as Y.Text).insert(0, '[done] ');
    away.sync();
    await settle();

    // Mid-word, the browser is anchored into this element. Writing to it now makes
    // it commit the finished word at an offset that no longer exists.
    expect(cell.innerHTML).toBe('Testing Sign Up ');

    // Telex: each keystroke reshapes the word in place. None of it may go out while
    // the element is a word behind the document.
    for (const step of ['d', 'du', 'duo', 'duoc', 'được']) {
      cell.innerHTML = `Testing Sign Up ${step}`;
      cell.dispatchEvent(new Event('input', { bubbles: true }));
    }
    expect(cellOf(h.blocks, 1, 1).toString()).toBe('[done] Testing Sign Up ');

    cell.dispatchEvent(new Event('compositionend', { bubbles: true }));
    await settle();

    // Both survive: the word lands where it was typed, not where the stale offset
    // said, and the edit that was held back is written in afterwards.
    expect(cellOf(h.blocks, 1, 1).toString()).toBe('[done] Testing Sign Up được');
    expect(h.editor.cell(1, 1).innerHTML).toBe('[done] Testing Sign Up được');
    away.sync();
    expect(grid(away.blocks)[1]![1]).toBe('[done] Testing Sign Up được');
  });

  it('lets go of a composition that never ended, when focus leaves the cell', async () => {
    // A keyboard swapped mid-word, or a phone tearing the view down: no
    // `compositionend` ever arrives. Without a second release the cell would stop
    // accepting other people's edits for as long as the page stayed open.
    const away = peer(h.doc);
    const cell = h.editor.cell(1, 1);
    caretToEnd(cell);
    cell.dispatchEvent(new Event('compositionstart', { bubbles: true }));

    (cellsOf(rowsOf(away.blocks.get(0))!.get(1))!.get(1) as Y.Text).insert(0, '[done] ');
    away.sync();
    await settle();
    expect(cell.innerHTML).toBe('Testing Sign Up');

    cell.dispatchEvent(new Event('focusout', { bubbles: true }));
    await settle();

    expect(h.editor.cell(1, 1).innerHTML).toBe('[done] Testing Sign Up');
  });

  it('leaves every other cell writable while one is composing', async () => {
    const away = peer(h.doc);
    const composing = h.editor.cell(1, 1);
    composing.focus();
    composing.dispatchEvent(new Event('compositionstart', { bubbles: true }));

    (cellsOf(rowsOf(away.blocks.get(0))!.get(2))!.get(1) as Y.Text).insert(0, 'Re-plan: ');
    away.sync();
    await settle();

    expect(h.editor.cell(2, 1).innerHTML).toBe('Re-plan: Plan for new members');
  });
});

describe('a table stored before the grid shape existed', () => {
  it('moves onto rows the first time somebody types in it, and not before', async () => {
    const legacy: StoredBlock = {
      id: 'old',
      type: 'table',
      data: { withHeadings: false, content: [['a', 'b']], rowHeights: [40] },
    };
    const doc = new Y.Doc();
    const blocks = blocksOf(doc);
    // The shape as it was written: cells in `data`, no `rows`.
    const map = new Y.Map<unknown>();
    map.set('id', legacy.id);
    map.set('type', legacy.type);
    map.set('data', legacy.data);
    blocks.insert(0, [map]);

    const editor = new FakeEditor([legacy]);
    const binding = bindEditorJs({
      editor: editor as unknown as Parameters<typeof bindEditorJs>[0]['editor'],
      blocks,
      holder: editor.holder,
    });
    await settle();

    expect(rowsOf(blocks.get(0))).toBeUndefined();

    type(editor.cell(0, 1), 'b!');
    expect(rowsOf(blocks.get(0))).toBeDefined();
    expect(grid(blocks)).toEqual([['a', 'b!']]);
    expect(readGrid(rowsOf(blocks.get(0))!).rowHeights).toEqual([40]);
    // The cells must not be left behind in `data` as well, or the next save puts
    // the pre-upgrade copy back over the top of them.
    expect((blocks.get(0).get('data') as Record<string, unknown>)['content']).toBeUndefined();

    binding.destroy();
  });
});

describe('a table created in the editor', () => {
  it('reaches the document with its real shape, not as nothing', async () => {
    const doc = new Y.Doc();
    const blocks = blocksOf(doc);
    // Editor.js mounts a table whose every cell is empty; `save()` reports no rows
    // at all, so without reading the DOM the document would hold a table and no
    // table to show.
    const editor = new FakeEditor([
      { id: 'fresh', type: 'table', data: { withHeadings: false, content: [['', ''], ['', '']] } },
    ]);
    const binding = bindEditorJs({
      editor: editor as unknown as Parameters<typeof bindEditorJs>[0]['editor'],
      blocks,
      holder: editor.holder,
    });
    await settle();

    binding.pull();
    await settle();

    expect(blocks.length).toBe(1);
    expect(grid(blocks)).toEqual([
      ['', ''],
      ['', ''],
    ]);
    binding.destroy();
  });
});

describe('the binding', () => {
  it('stops listening when it is destroyed', async () => {
    const h = mount();
    await settle();
    h.binding.destroy();

    const before = cellOf(h.blocks, 1, 1).toString();
    type(h.editor.cell(1, 1), 'after destroy');
    expect(cellOf(h.blocks, 1, 1).toString()).toBe(before);
  });
});
