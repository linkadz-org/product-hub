/**
 * How an Editor.js document lives inside a Y.Doc.
 *
 * BlockNote could hand Yjs a ProseMirror fragment and be done; Editor.js has no
 * such binding, so the shape is ours and this file *is* the contract — the
 * browser writes it (see `editorjsBinding.ts`) and the sync server reads it back
 * out to render the HTML mirror. Both sides load this same module: the collab
 * package's copy is generated from this file, so the two cannot drift.
 *
 *   Y.Array('blocks')
 *     └── Y.Map per block
 *           id    : string   the Editor.js block id, shared by every client
 *           type  : string   'paragraph' | 'header' | 'table' | …
 *           data  : object   the tool's data *minus* its text fields (plain JSON)
 *           <field>: Y.Text  one per entry in TEXT_FIELDS[type]
 *           rows  : Y.Array  grid blocks only — see GRID_FIELDS
 *                 └── Y.Map per row
 *                       id    : string        identifies the row in the DOM
 *                       cells : Y.Array<Y.Text>
 *                       h     : number?       row height in px, 0/absent = natural
 *
 * The split between `data` and the Y types is the whole design decision, and it
 * is a trade-off worth stating plainly:
 *
 *  · A **text** field is a Y.Text, so two people typing in the same paragraph
 *    merge character by character — the thing "realtime" actually means.
 *  · A **grid** block (a table) puts every cell in its own Y.Text, inside a
 *    Y.Array of rows. Two people on different rows, on different cells of one
 *    row, or in the same cell all merge, and two people adding a row at the same
 *    time both keep theirs.
 *  · Everything else (a list's items, an image's file) is plain JSON, written
 *    whole. Concurrent edits to *one* such block resolve last-writer-wins rather
 *    than merging. That is the honest cost of a block editor whose structured
 *    tools keep their state as one object; the editor shows who else is in a
 *    block so it doesn't happen silently.
 *
 * Different blocks always merge, whatever their type — which is the case that
 * actually happens when two people write in one page.
 *
 * Two things a grid still cannot save, both of them a conflict of intent rather
 * than a technical limit: deleting a row somebody is typing in (the delete wins),
 * and *moving* one (Yjs has no native move, so a move is a delete plus an insert
 * and the new row inherits nothing). The table tool's drag handles resize rows
 * and columns — they do not reorder them. Don't add row reordering without
 * solving that first.
 */
import * as Y from 'yjs';

/** The Y.Doc field holding the block list. Both sides must agree. */
export const BLOCKS_KEY = 'blocks';

/**
 * Which of a tool's data fields hold text a person types, in the order their
 * editable elements appear in the block. The order matters: the browser reads
 * them straight off the DOM (`[contenteditable]` / `<textarea>`) rather than
 * asking each tool, which is what makes the read synchronous — and a synchronous
 * read is what stops a keystroke being lost between the DOM and the CRDT.
 *
 * A tool that isn't listed here is synced as one JSON value. Adding one is a
 * two-line change, but only do it when the tool's editables really do map 1:1,
 * in order, onto its data fields.
 */
export const TEXT_FIELDS: Record<string, readonly string[]> = {
  paragraph: ['text'],
  header: ['text'],
  quote: ['text'],
  // <summary> first, then the folded body — the order they render in.
  toggle: ['summary', 'text'],
  code: ['code'],
  mermaid: ['code'],
};

/**
 * Block types whose text is a **grid** rather than a fixed list of fields, and
 * the `data` field holding that grid as `string[][]`.
 *
 * A grid type's cells are lifted out of `data` into `rows` (see the shape at the
 * top of this file) and put back by `fromYBlock`, so every reader downstream —
 * `editorjs.ts`, the HTML mirror, Editor.js itself — keeps seeing the plain
 * `string[][]` it always saw. Nothing outside this file knows the difference.
 */
export const GRID_FIELDS: Record<string, string> = {
  table: 'content',
};

export const gridFieldOf = (type: string): string | undefined => GRID_FIELDS[type];

/** Keys inside a grid block's Y.Map and a row's Y.Map. Both sides must agree. */
export const ROWS_KEY = 'rows';
export const ROW_ID = 'id';
export const ROW_CELLS = 'cells';
export const ROW_HEIGHT = 'h';

/**
 * `data` fields of a grid block that are aligned to *rows* and therefore cannot
 * stay in `data`: two people adding a row at the same time both keep their row,
 * which would leave a row-indexed array one short and shift every height onto
 * the wrong row. Column-aligned ones (`colWidths`) are safe — a concurrent row
 * insert doesn't move a column.
 */
const ROW_ALIGNED: Record<string, string> = {
  table: 'rowHeights',
};

export type YCells = Y.Array<Y.Text>;
export type YRow = Y.Map<unknown>;
export type YRows = Y.Array<YRow>;

/**
 * A row id.
 *
 * Yjs already identifies a row on its own — a Y.Array element is an Item with a
 * `(client, clock)` id, which is what merges two concurrent inserts — so this is
 * *not* what makes the CRDT correct. It exists for the binding: reading a table
 * back out of the DOM, it is the only way to tell "a row was inserted above" from
 * "every row's text changed", and getting that wrong rewrites text nobody
 * touched and throws away everyone's caret. Exactly why blocks carry an id too.
 */
export const newRowId = (): string => Math.random().toString(36).slice(2, 10);

/** Marks a Yjs transaction as this client's own, so its observer can skip it. */
export const LOCAL_ORIGIN = 'editorjs-local';

/** A block the way Editor.js saves it (and the way the HTML converter wants it). */
export interface StoredBlock {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export type YBlock = Y.Map<unknown>;
export type YBlocks = Y.Array<YBlock>;

export const textFieldsOf = (type: string): readonly string[] => TEXT_FIELDS[type] ?? [];

/** The block list of a doc. */
export const blocksOf = (doc: Y.Doc): YBlocks => doc.getArray<YBlock>(BLOCKS_KEY);

/** One block's text field, or '' when the tool has no such field. */
export function textOf(block: YBlock, field: string): string {
  const value = block.get(field);
  return value instanceof Y.Text ? value.toString() : '';
}

// ── Grids ───────────────────────────────────────────────────────────────────

/** A row as the binding reads it off the DOM and writes it back. */
export interface GridRow {
  id: string;
  cells: string[];
  /** px; 0 or absent means the row takes its natural height. */
  height?: number;
}

/** The rows of a grid block, or undefined when it has none. */
export function rowsOf(block: YBlock): YRows | undefined {
  const rows = block.get(ROWS_KEY);
  return rows instanceof Y.Array ? (rows as YRows) : undefined;
}

export function cellsOf(row: YRow): YCells | undefined {
  const cells = row.get(ROW_CELLS);
  return cells instanceof Y.Array ? (cells as YCells) : undefined;
}

export const rowIdOf = (row: YRow): string => String(row.get(ROW_ID) ?? '');

/**
 * One row, detached. Not attached to a document yet — same rule as `toYBlock`:
 * Yjs requires a type to be integrated before it can be read.
 */
export function toYRow(cells: string[], height?: number, id?: string): YRow {
  const row = new Y.Map<unknown>();
  const list = new Y.Array<Y.Text>();
  list.insert(0, cells.map((cell) => new Y.Text(cell)));
  row.set(ROW_ID, id || newRowId());
  row.set(ROW_CELLS, list);
  if (height) row.set(ROW_HEIGHT, height);
  return row;
}

/** The `rows` of a grid block, built from the `string[][]` sitting in its data. */
export function toYRows(block: StoredBlock): YRows {
  const field = gridFieldOf(block.type);
  const source = field ? block.data?.[field] : undefined;
  const aligned = ROW_ALIGNED[block.type];
  const heights = (aligned ? block.data?.[aligned] : undefined) as number[] | undefined;

  const rows = new Y.Array<YRow>();
  const lines = Array.isArray(source) ? (source as unknown[]) : [];
  rows.insert(
    0,
    lines.map((line, i) =>
      toYRow(
        Array.isArray(line) ? line.map((cell) => String(cell ?? '')) : [],
        Number(heights?.[i]) || undefined,
      ),
    ),
  );
  return rows;
}

/** A grid back as the `string[][]` (plus row heights) every reader expects. */
export function readGrid(rows: YRows): { content: string[][]; rowHeights?: number[] } {
  const content: string[][] = [];
  const heights: number[] = [];
  let sized = false;
  let widest = 0;

  rows.forEach((row) => {
    const cells = cellsOf(row);
    const line = cells ? cells.map((cell) => cell.toString()) : [];
    widest = Math.max(widest, line.length);
    content.push(line);
    const height = Number(row.get(ROW_HEIGHT) ?? 0);
    heights.push(Number.isFinite(height) ? height : 0);
    if (height) sized = true;
  });

  // Two people adding a column at the same time leaves rows of unequal length.
  // Everything downstream indexes a table by column, so square it off here
  // rather than leave each reader to meet a ragged row on its own.
  for (const line of content) while (line.length < widest) line.push('');

  return sized ? { content, rowHeights: heights } : { content };
}

/**
 * The plain-JSON half of a block's data — everything *not* kept as a Y type: not
 * a text field, not a grid's cells, not a size aligned to those cells' rows.
 *
 * Two writers need exactly this set — `toYBlock` when a block is created, and the
 * binding's `updateYBlock` when one is edited — and they are the pair that must
 * not drift. A field left in `data` as well as in a Y type is stored twice, and
 * the stale JSON copy wins the next time anybody saves the block: precisely the
 * failure this shape was introduced to end.
 */
export function jsonDataOf(block: StoredBlock): Record<string, unknown> {
  const fields = textFieldsOf(block.type);
  const grid = gridFieldOf(block.type);
  const aligned = grid ? ROW_ALIGNED[block.type] : undefined;

  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block.data ?? {})) {
    if (fields.includes(key) || key === grid || key === aligned) continue;
    rest[key] = value;
  }
  return rest;
}

/**
 * A Y.Map for a block. Not attached to a document yet — Yjs requires a type to
 * be integrated before it can be read, so callers insert it and then read back.
 */
export function toYBlock(block: StoredBlock): YBlock {
  const map = new Y.Map<unknown>();
  const fields = textFieldsOf(block.type);
  const grid = gridFieldOf(block.type);

  map.set('id', block.id);
  map.set('type', block.type);
  map.set('data', jsonDataOf(block));
  for (const field of fields) {
    map.set(field, new Y.Text(String(block.data?.[field] ?? '')));
  }
  if (grid) map.set(ROWS_KEY, toYRows(block));
  return map;
}

/** The inverse: one block as Editor.js expects to be handed it. */
export function fromYBlock(map: YBlock): StoredBlock {
  const type = String(map.get('type') ?? 'paragraph');
  const data: Record<string, unknown> = { ...((map.get('data') as object) ?? {}) };
  for (const field of textFieldsOf(type)) data[field] = textOf(map, field);

  const grid = gridFieldOf(type);
  const rows = grid ? rowsOf(map) : undefined;
  // A grid block with no `rows` is a table stored before grids existed, still
  // carrying its cells in `data` — so leaving `data` untouched is exactly right.
  // `upgradeGrid` converts it the first time somebody edits it, one table at a
  // time, the same way a page migrates on its first collaborative open.
  if (grid && rows) {
    const { content, rowHeights } = readGrid(rows);
    data[grid] = content;
    const aligned = ROW_ALIGNED[type];
    if (aligned) {
      if (rowHeights) data[aligned] = rowHeights;
      else delete data[aligned];
    }
  }
  return { id: String(map.get('id') ?? ''), type, data };
}

export const readBlocks = (blocks: YBlocks): StoredBlock[] => blocks.map(fromYBlock);

/**
 * Replaces the whole list — seeding a page on its first collaborative open, and
 * restoring a version onto the screens of everyone currently reading it.
 *
 * One transaction, so connected clients receive it as a single update and apply
 * it in one repaint instead of watching the page rebuild block by block.
 */
export function replaceBlocks(blocks: YBlocks, next: StoredBlock[], origin: unknown): void {
  const doc = blocks.doc;
  const run = () => {
    if (blocks.length) blocks.delete(0, blocks.length);
    if (next.length) blocks.insert(0, next.map(toYBlock));
  };
  if (doc) doc.transact(run, origin);
  else run();
}

/**
 * Edits a Y.Text into `next` with the smallest edit that gets there: keep the
 * common prefix and suffix, replace what's between.
 *
 * Minimal matters for more than bytes on the wire. Replacing the whole string
 * would delete and re-insert every character, which moves everyone else's cursor
 * to the start of the paragraph and turns a one-letter fix into a conflict with
 * whatever they were typing.
 */
export function applyTextDiff(text: Y.Text, next: string): boolean {
  const prev = text.toString();
  if (prev === next) return false;

  const max = Math.min(prev.length, next.length);
  let start = 0;
  while (start < max && prev[start] === next[start]) start += 1;
  let end = 0;
  while (end < max - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) {
    end += 1;
  }

  const removed = prev.length - start - end;
  const inserted = next.slice(start, next.length - end);
  if (removed > 0) text.delete(start, removed);
  if (inserted) text.insert(start, inserted);
  return true;
}

/** Structural equality for the plain-JSON half of a block's data. */
export function sameData(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Where a row id sits in the grid, or -1. */
export function indexOfRow(rows: YRows, id: string): number {
  if (!id) return -1;
  for (let i = 0; i < rows.length; i += 1) if (rowIdOf(rows.get(i)) === id) return i;
  return -1;
}

/**
 * Edits `rows` into `next` with the smallest edit that gets there — the grid
 * half of what `applyTextDiff` does for a paragraph, and minimal for the same
 * reason: anything rewritten is a caret somebody loses.
 *
 * Rows are matched **by id, never by position**, and that is the whole point.
 * Position alone cannot tell "a row was inserted above" from "every row's text
 * changed", and guessing wrong rewrites rows nobody touched — which on a page
 * four people share is indistinguishable from the bug this shape exists to fix.
 */
export function applyGridDiff(rows: YRows, next: GridRow[]): void {
  const wanted = new Set(next.map((row) => row.id));
  // Backwards: deleting a row shifts every index after it.
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (!wanted.has(rowIdOf(rows.get(i)))) rows.delete(i, 1);
  }

  next.forEach((row, i) => {
    const at = indexOfRow(rows, row.id);
    if (at < 0) rows.insert(Math.min(i, rows.length), [toYRow(row.cells, row.height, row.id)]);
    else applyRowDiff(rows.get(at), row);
  });
}

function applyRowDiff(row: YRow, next: GridRow): void {
  const cells = cellsOf(row);
  if (!cells) return;

  if (cells.length === next.cells.length) {
    next.cells.forEach((value, i) => {
      const cell = cells.get(i);
      if (cell instanceof Y.Text) applyTextDiff(cell, value);
    });
  } else {
    // A changed cell *count* is a column added or removed, and where is not
    // knowable from the DOM — a new column is empty in every row, so it looks
    // exactly like the last one. Rebuild rather than guess: it costs this row's
    // caret for one edit, against shifting every cell's text a column over.
    cells.delete(0, cells.length);
    cells.insert(0, next.cells.map((cell) => new Y.Text(cell)));
  }

  const height = next.height ?? 0;
  if (height) {
    if (row.get(ROW_HEIGHT) !== height) row.set(ROW_HEIGHT, height);
  } else if (row.has(ROW_HEIGHT)) {
    row.delete(ROW_HEIGHT);
  }
}

/**
 * Moves a grid block stored the old way — cells as `string[][]` in `data` — onto
 * `rows`, in place.
 *
 * Lazy and per block, for the same reason page seeding is: there is no batch job
 * to run and no flag day, and a table that nobody opens keeps working exactly as
 * it did. Returns false when there was nothing to do.
 */
export function upgradeGrid(map: YBlock): boolean {
  const type = String(map.get('type') ?? '');
  const field = gridFieldOf(type);
  if (!field || rowsOf(map)) return false;

  const block = { id: String(map.get('id') ?? ''), type, data: { ...((map.get('data') as object) ?? {}) } };
  map.set(ROWS_KEY, toYRows(block));

  // The cells now live in `rows`; leaving a copy in `data` would let a writer
  // that hasn't been upgraded put the stale one back.
  const data = { ...(block.data as Record<string, unknown>) };
  delete data[field];
  const aligned = ROW_ALIGNED[type];
  if (aligned) delete data[aligned];
  map.set('data', data);
  return true;
}
