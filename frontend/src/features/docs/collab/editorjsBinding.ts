/**
 * Editor.js ⇄ Yjs.
 *
 * The piece that doesn't exist as a library: BlockNote has `withCollaboration`,
 * ProseMirror has y-prosemirror, Editor.js has nothing. This is that binding —
 * one document, two directions, written against the shape in `blockDoc.ts`.
 *
 * Two directions, deliberately different in kind:
 *
 *  **Editor.js → Y**  Text is pushed on `input`, *synchronously*, straight off
 *  the DOM. That is the whole reason keystrokes aren't lost: the moment the DOM
 *  is ahead of the CRDT is the moment a remote update can arrive and overwrite
 *  it, so that moment is kept at zero. Structure (blocks added, removed, moved,
 *  converted) and the JSON half of a block's data come from `editor.save()`,
 *  which is async — and is re-run if a remote update lands while it's in flight,
 *  so a stale snapshot can never revert somebody else's edit.
 *
 *  **Y → Editor.js**  A text change is written into the editable element in
 *  place, with the caret mapped across the edit — no re-render, because
 *  re-rendering a block is what makes a collaborative editor feel like it's
 *  fighting you. Only structural changes go through the Editor.js API, and those
 *  are queued so two of them can't interleave.
 *
 * Every write in both directions is a *diff*, so any pass that runs twice is a
 * no-op the second time. That property is what keeps the two loops from
 * chasing each other.
 *
 * One rule underpins both directions, and it is the one worth remembering: **a
 * block the CRDT has never held is not a block somebody deleted.** An editor
 * always has blocks the document doesn't yet — the empty paragraph Editor.js
 * mounts with, a block typed a moment ago — and treating either side's list as
 * the whole truth is how a page loses text. So `known` records every id the
 * document has actually carried; only those may be deleted on either side.
 *
 * **A table is read from the DOM, never from `editor.save()`.** The table tool's
 * `getData()` drops rows that are entirely empty, so a row somebody just added is
 * simply missing from the snapshot — reconciling that would delete their row for
 * everyone. The DOM has every row, and `data-yrow` on each one carries the id the
 * document knows it by, which is what lets a row be matched by identity instead of
 * by position. See `stampRows`.
 *
 * **Nothing is written into an element an IME is composing in.** Telex, pinyin and
 * every phone keyboard type through a composition the browser is anchored to
 * mid-word; replacing that element's contents makes it commit the finished word at
 * a position that no longer exists, and the text lands scrambled. Such a write is
 * held back and re-applied at `compositionend` — late, but intact.
 */
import type EditorJS from '@editorjs/editorjs';
import * as Y from 'yjs';
import {
  LOCAL_ORIGIN,
  ROWS_KEY,
  ROW_HEIGHT,
  applyGridDiff,
  applyTextDiff,
  cellsOf,
  fromYBlock,
  gridFieldOf,
  indexOfRow,
  jsonDataOf,
  newRowId,
  readBlocks,
  rowIdOf,
  rowsOf,
  sameData,
  textFieldsOf,
  textOf,
  toYBlock,
  upgradeGrid,
  type GridRow,
  type StoredBlock,
  type YBlock,
  type YBlocks,
  type YRows,
} from './blockDoc';
import {
  blockElementOf,
  caretOffset,
  gridCells,
  gridRowOf,
  gridRows,
  holderOf,
  isTextarea,
  plainText,
  rowHeightOf,
  setCaretOffset,
  textHolders,
  type TextHolder,
} from './domText';

/**
 * Where a row's document id is kept in the DOM.
 *
 * Safe to put on `.tc-row` specifically: the table tool saves a table by reading
 * `.tc-cell` innerHTML, so nothing on the row itself can end up as table content.
 * (A handle inside a cell *would* — which is why the tool's own row handles live
 * here too.)
 */
const ROW_ATTR = 'yrow';

interface Options {
  editor: EditorJS;
  blocks: YBlocks;
  /** The element the editor renders into — where `input` is listened for. */
  holder: HTMLElement;
  /** Called after a remote change lands, so the page can re-measure overlays. */
  onRemote?: () => void;
}

export interface EditorJsBinding {
  /** Editor.js changed: reconcile structure and data into the CRDT. */
  pull: () => void;
  destroy: () => void;
}

/** What `editor.blocks.getBlockByIndex` hands back — Editor.js's block handle. */
type BlockHandle = ReturnType<EditorJS['blocks']['getBlockByIndex']>;

const valueOf = (el: TextHolder): string =>
  isTextarea(el) ? el.value : (el as HTMLElement).innerHTML;

/**
 * Where offset `at` in `before` ends up in `after`.
 *
 * The same prefix/suffix reasoning `applyTextDiff` uses, run backwards: text
 * typed *before* the caret pushes it along, text typed after it leaves it alone,
 * and an edit that spans it leaves the caret at the near edge of the change
 * rather than somewhere arbitrary.
 */
function mapOffset(before: string, after: string, at: number): number {
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  if (at <= prefix) return at;
  if (at >= before.length - suffix) return at + (after.length - before.length);
  return Math.max(0, Math.min(Math.max(at, prefix), after.length - suffix));
}

export function bindEditorJs({ editor, blocks, holder, onRemote }: Options): EditorJsBinding {
  const doc = blocks.doc;
  /** True while remote changes are being written into the editor. */
  let applying = false;
  let destroyed = false;
  /**
   * Bumped by every remote change. `pull()` reads it before `editor.save()` and
   * again after: if it moved, the snapshot it is holding predates somebody
   * else's edit, and diffing it into the CRDT would undo them — so it starts over.
   */
  let remoteVersion = 0;
  /** Structural work, one at a time — and `pull()`, which queues behind it. */
  let queue: Promise<void> = Promise.resolve();
  /** A pull asked for while the editor was busy being written into. */
  let pendingPull = false;
  /** A pull already waiting its turn — see `enqueuePull`. */
  let pullQueued = false;
  /**
   * Every block id the document has held, as far as this client has seen.
   *
   * The difference between "gone" and "not here yet". A local block missing from
   * the document is only a deletion if the document *had* it; otherwise it is
   * simply younger than the last sync, and deleting it would throw away what
   * somebody just typed.
   */
  const known = new Set<string>();
  /**
   * The editable an IME is composing in, while it is composing.
   *
   * Not a boolean, because "is something being composed" isn't the question — the
   * question is whether *this* element is the one mid-word, since every other
   * element on the page can still be written into safely.
   */
  let composing: TextHolder | null = null;
  /**
   * Where the word being composed will land, and what it will land in.
   *
   * A Yjs *relative* position, not an offset: if somebody edits earlier in the
   * same cell while the word is still being typed, the document carries this
   * anchor along with their edit, and the finished word still lands where the
   * person meant to put it. Null when the position couldn't be pinned down — see
   * `endComposition` for what happens then.
   */
  let composedIn: Y.Text | null = null;
  let composedAt: Y.RelativePosition | null = null;
  /**
   * The element's value when the word started, and where in it the caret was.
   *
   * Enough to recover the composed run without asking the browser for it: whatever
   * a composition produces sits between the text that was before the caret and the
   * text that was after it, both of which a composition leaves alone. Derived
   * rather than taken from `CompositionEvent.data` so that a composition which ends
   * without that event — the case `endComposition` exists to survive — is handled
   * by exactly the same arithmetic.
   */
  let composedBase = '';
  let composedStart = 0;
  /**
   * Blocks whose remote state was held back from the DOM because of the above.
   * Re-applied when the composition ends; a set, because a long word can outlast
   * several remote updates and only the latest state matters.
   */
  const deferred = new Set<string>();

  const idAt = (index: number): string | null => {
    const block = editor.blocks.getBlockByIndex(index);
    return block ? block.id : null;
  };

  /**
   * A block by id — or nothing, quietly.
   *
   * Not `editor.blocks.getById`, and emphatically not `getBlockIndex`. Both log
   * a warning for an id the editor doesn't hold, and `getBlockIndex` answers
   * `undefined` rather than -1 whatever its types say, so a `< 0` test reads a
   * miss as a hit at index `undefined` and the block is silently never
   * inserted. A miss is *ordinary* here — every remote insert arrives for a
   * block this editor hasn't rendered yet — so both questions are answered by
   * scanning: exact, and silent.
   */
  function blockById(id: string): BlockHandle {
    for (let i = 0; i < editor.blocks.getBlocksCount(); i += 1) {
      const block = editor.blocks.getBlockByIndex(i);
      if (block?.id === id) return block;
    }
    return undefined;
  }

  /** Where a block sits in the editor, or -1 when it isn't there. */
  function indexInEditor(id: string): number {
    for (let i = 0; i < editor.blocks.getBlocksCount(); i += 1) {
      if (idAt(i) === id) return i;
    }
    return -1;
  }

  /** Read the document, remembering every id it carries. */
  function target(): StoredBlock[] {
    const list = readBlocks(blocks);
    for (const block of list) known.add(block.id);
    return list;
  }

  // ── Grids ────────────────────────────────────────────────────────────────

  /**
   * Whether an element is the one an IME is mid-word in.
   *
   * Only the two facts that are the question: something is being composed, and it
   * is in here. Deliberately *not* also checking `document.activeElement` — an
   * element being composed in is the focused one anyway, so the test adds nothing
   * on the path that matters, while making the guard fail open in every
   * environment that reports focus differently. A stale composition is guarded
   * against by *releasing* it — see `endComposition` — not by second-guessing it
   * here on every write.
   */
  function isComposing(element: TextHolder): boolean {
    if (!composing || !composing.isConnected) return false;
    return element === composing || element.contains(composing);
  }

  /**
   * The Y.Text behind one editable — a table cell or a block's text field.
   *
   * The reverse of the two write paths, and used for one thing only: anchoring a
   * composition. A cell is found by its *row id* rather than its position, so a row
   * arriving above it while the word is being typed doesn't move the anchor onto
   * somebody else's row.
   */
  function yTextOf(element: TextHolder): Y.Text | null {
    const blockEl = blockElementOf(element);
    const api = blockEl ? editor.blocks.getBlockByElement(blockEl) : undefined;
    if (!blockEl || !api) return null;
    const index = indexOfId(api.id);
    if (index < 0) return null;
    const map = blocks.get(index);

    if (gridFieldOf(api.name)) {
      const rowEl = gridRowOf(element);
      const rows = rowsOf(map);
      if (!rowEl || !rows) return null;
      const at = indexOfRow(rows, rowEl.dataset[ROW_ATTR] ?? '');
      if (at < 0) return null;
      const cell = cellsOf(rows.get(at))?.get(gridCells(rowEl).indexOf(element as HTMLElement));
      return cell instanceof Y.Text ? cell : null;
    }

    const field = textFieldsOf(api.name)[textHolders(blockEl).indexOf(element)];
    const text = field ? map.get(field) : undefined;
    return text instanceof Y.Text ? text : null;
  }

  /**
   * Give every rendered row of a grid the id the document knows it by.
   *
   * Alignment is by position, which is *only* sound here: a table just rendered
   * from the document has the document's rows, in the document's order. Once
   * stamped, an id survives the row being typed in, resized, or pushed down by an
   * insert above it — and that is what the read side matches on.
   *
   * When the two disagree on how many rows there are, a row has just been added or
   * removed in this editor and which one is not knowable from a count, so only the
   * unnamed rows get fresh ids. That case is a new row and nothing else, because
   * stamping happens when a table is rendered — long before anyone can add to it.
   */
  function stampRows(element: HTMLElement, rows: YRows): void {
    const dom = gridRows(element);
    const aligned = dom.length === rows.length;
    dom.forEach((el, i) => {
      if (el.dataset[ROW_ATTR]) return;
      el.dataset[ROW_ATTR] = aligned ? rowIdOf(rows.get(i)) || newRowId() : newRowId();
    });
  }

  /** Every rendered grid, stamped. Cheap, idempotent, and run after any render. */
  function stampGrids(): void {
    for (let i = 0; i < blocks.length; i += 1) {
      const map = blocks.get(i);
      if (!gridFieldOf(String(map.get('type') ?? ''))) continue;
      const rows = rowsOf(map);
      const api = rows ? blockById(String(map.get('id') ?? '')) : undefined;
      if (rows && api) stampRows(api.holder, rows);
    }
  }

  /** A grid as it stands in the editor. Stamp first, or the ids will be fresh. */
  const gridFromDom = (element: HTMLElement): GridRow[] =>
    gridRows(element).map((el) => ({
      id: el.dataset[ROW_ATTR] || newRowId(),
      cells: gridCells(el).map((cell) => cell.innerHTML),
      height: rowHeightOf(el) || undefined,
    }));

  /**
   * Read a grid off the DOM and diff it into the document.
   *
   * Upgrades the block on the way past: a table stored before grids existed keeps
   * its cells in `data`, and the first edit is exactly when it should stop.
   *
   * Does nothing when the block isn't rendered in this editor — no DOM to read,
   * and the save snapshot is not an acceptable substitute (see the file header).
   */
  function pushGrid(map: YBlock, id: string): void {
    const api = blockById(id);
    if (!api) return;
    upgradeGrid(map);
    const rows = rowsOf(map);
    if (!rows) return;
    stampRows(api.holder, rows);
    applyGridDiff(rows, gridFromDom(api.holder));
  }

  /**
   * Whether a rendered table has the same shape as the document's — same rows,
   * same columns in each, same dragged heights.
   *
   * Only the tool can add a row or a column to its own DOM, so a shape change is
   * the one grid update that has to go through a re-render. Everything else, which
   * is to say everybody's typing, is written in place.
   */
  function sameShape(rows: YRows, dom: HTMLElement[]): boolean {
    if (rows.length !== dom.length) return false;
    for (let i = 0; i < rows.length; i += 1) {
      const cells = cellsOf(rows.get(i));
      if (!cells || cells.length !== gridCells(dom[i]).length) return false;
      if (Number(rows.get(i).get(ROW_HEIGHT) ?? 0) !== rowHeightOf(dom[i])) return false;
    }
    return true;
  }

  // ── Editor.js → Y ────────────────────────────────────────────────────────

  /**
   * The fast path: one editable changed, push just that field.
   *
   * Runs in the `input` handler, before the browser has done anything else, so
   * the CRDT is never behind the DOM by more than the width of this function.
   */
  function pushTextFromDom(target: Node | null): void {
    if (applying || destroyed) return;
    const element = blockElementOf(target);
    if (!element) return;
    const api = editor.blocks.getBlockByElement(element);
    if (!api) return;
    const fields = textFieldsOf(api.name);
    const grid = gridFieldOf(api.name);
    if (!fields.length && !grid) return;

    // This block's DOM is a word behind the document: a remote edit was held back
    // from the element being composed in, so the element no longer says what the
    // document says. Diffing it now would read the difference as a local deletion
    // and take out what the other person just typed. Nothing goes out from here
    // until the word is finished and `endComposition` merges it in by position —
    // so peers see the word appear whole rather than letter by letter, which is
    // the price of not overwriting them and is only paid when they are in the very
    // same cell.
    if (composing && deferred.has(api.id) && element.contains(composing)) return;

    const index = indexOfId(api.id);
    // Not in the CRDT yet — a block created a moment ago. There is no field to
    // diff into, so publish the block whole. Waiting for the editor's own
    // change event would do it eventually, but Editor.js leaves an empty
    // paragraph out of `save()` entirely, so pressing Enter emits nothing at
    // all and the first characters of every new block would arrive a debounce
    // late.
    if (index < 0) {
      enqueuePull();
      return;
    }
    const yBlock = blocks.get(index);

    // A table. Every cell is its own Y.Text, so a keystroke reaches the document
    // as a keystroke in one cell — which is the whole difference between four
    // people filling in a table and three of them losing their afternoon.
    if (grid) {
      doc?.transact(() => pushGrid(yBlock, api.id), LOCAL_ORIGIN);
      return;
    }

    const holders = textHolders(element);
    if (holders.length < fields.length) return;

    doc?.transact(() => {
      fields.forEach((field, i) => {
        const text = yBlock.get(field);
        if (text instanceof Y.Text) applyTextDiff(text, valueOf(holders[i]));
      });
    }, LOCAL_ORIGIN);
  }

  /** Everything else: the block list, block types, and the JSON half of data. */
  async function pullNow(): Promise<void> {
    if (destroyed) return;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const version = remoteVersion;
      const saved = await editor.save().catch(() => null);
      if (!saved || destroyed) return;
      // A remote update landed while we were saving: this snapshot is already
      // out of date, so diffing it in would revert somebody. Take another.
      if (remoteVersion !== version) continue;

      // The document holds a block this editor has never rendered — it arrived
      // while the render for it was still queued. The snapshot therefore
      // describes a document without it, and reconciling that would delete it
      // for everybody. This is not hypothetical: writing into the editor fires
      // Editor.js's own change event, so *receiving* somebody's keystroke asks
      // this client to reconcile, and it must not answer with a stale list.
      if (hasUnseen()) {
        pendingPull = true;
        return;
      }

      const local = (saved.blocks ?? [])
        .filter((b): b is typeof b & { id: string } => !!b.id)
        .map<StoredBlock>((b) => ({
          id: b.id,
          type: b.type,
          data: (b.data ?? {}) as Record<string, unknown>,
        }));

      // A page nobody has typed in yet is Editor.js's own empty paragraph, not
      // a document. Writing it would race two clients into two empty blocks.
      if (!blocks.length && local.length === 1 && isBlank(local[0])) return;

      doc?.transact(() => reconcile(local), LOCAL_ORIGIN);
      return;
    }
  }

  const isBlank = (block: StoredBlock): boolean =>
    block.type === 'paragraph' && !String(block.data?.text ?? '').trim();

  /** True when the document holds a block this editor has never rendered. */
  function hasUnseen(): boolean {
    for (let i = 0; i < blocks.length; i += 1) {
      if (!known.has(String(blocks.get(i).get('id')))) return true;
    }
    return false;
  }

  function indexOfId(id: string): number {
    for (let i = 0; i < blocks.length; i += 1) {
      if (blocks.get(i).get('id') === id) return i;
    }
    return -1;
  }

  function reconcile(local: StoredBlock[]): void {
    const wanted = new Set(local.map((b) => b.id));
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      if (!wanted.has(String(blocks.get(i).get('id')))) blocks.delete(i, 1);
    }

    local.forEach((block, i) => {
      const current = i < blocks.length ? blocks.get(i) : undefined;
      if (current && current.get('id') === block.id) {
        updateYBlock(current, block);
        return;
      }
      // Moved, or brand new. A Yjs type can't be re-inserted once integrated,
      // so a move is a delete and a fresh map — which is also why moves are
      // reconciled from the mover's snapshot rather than merged.
      const at = indexOfId(block.id);
      if (at >= 0) blocks.delete(at, 1);
      blocks.insert(i, [toYBlock(block)]);
      known.add(block.id);
      // A table Editor.js has only just created saves as no rows at all — every
      // cell is empty, and `getData()` keeps no empty rows. Read the real shape
      // off the DOM, so the person it appears for sees a table and not a gap.
      if (gridFieldOf(block.type)) pushGrid(blocks.get(i), block.id);
    });

    if (blocks.length > local.length) blocks.delete(local.length, blocks.length - local.length);
  }

  function updateYBlock(map: YBlock, block: StoredBlock): void {
    if (map.get('type') !== block.type) map.set('type', block.type);

    const fields = textFieldsOf(block.type);
    const rest = jsonDataOf(block);
    if (!sameData(map.get('data'), rest)) map.set('data', rest);

    // Rows and columns added or removed through the table's own toolbox arrive
    // here rather than as an `input`, so this is where they land. Read from the
    // DOM, never from `block.data` — the snapshot is missing any row left blank.
    if (gridFieldOf(block.type)) pushGrid(map, block.id);

    for (const field of fields) {
      const text = map.get(field);
      // Converting a paragraph to a heading keeps its Y.Text — and with it,
      // everyone's position in the sentence. Only a field the block didn't have
      // before (a paragraph becoming a code block) starts fresh.
      if (text instanceof Y.Text) applyTextDiff(text, String(block.data?.[field] ?? ''));
      else map.set(field, new Y.Text(String(block.data?.[field] ?? '')));
    }
  }

  // ── Y → Editor.js ────────────────────────────────────────────────────────

  /**
   * Put `next` into one editable, keeping the caret on the character it was on.
   *
   * The single place a remote edit touches the DOM, which is why the IME check
   * lives here and nowhere else: held back rather than written, and the block is
   * remembered so `compositionend` can finish the job. `blockId` is only for that
   * — the write itself doesn't need to know which block it is in.
   */
  function writeInto(element: TextHolder, next: string, blockId: string): void {
    if (valueOf(element) === next) return;
    if (isComposing(element)) {
      deferred.add(blockId);
      return;
    }

    if (isTextarea(element)) {
      const focused = document.activeElement === element;
      const before = element.value;
      const start = element.selectionStart ?? 0;
      const end = element.selectionEnd ?? 0;
      element.value = next;
      if (focused) {
        element.selectionStart = mapOffset(before, next, start);
        element.selectionEnd = mapOffset(before, next, end);
      }
      // The tools backed by a textarea keep their own copy of the source and
      // redraw from it (the diagram's preview, the code block's height), so tell
      // them the same way a keystroke would.
      element.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const el = element as HTMLElement;
    const before = plainText(el);
    const caret = caretOffset(el);
    el.innerHTML = next;
    if (caret >= 0) setCaretOffset(el, mapOffset(before, plainText(el), caret));
  }

  /** Write one text field into the DOM, keeping the caret where it belongs. */
  function applyText(blockId: string, field: string, next: string): boolean {
    const api = blockById(blockId);
    if (!api) return false;
    const fields = textFieldsOf(api.name);
    const slot = fields.indexOf(field);
    if (slot < 0) return false;
    const element = textHolders(api.holder)[slot];
    if (!element) return false;
    writeInto(element, next, blockId);
    return true;
  }

  /**
   * Bring the editor's block list in line with the CRDT.
   *
   * Only reached for structural change — a block appearing, going, moving, or
   * changing type or non-text data. Text never comes through here, so the common
   * case (somebody typing) never re-renders a block.
   */
  async function renderStructure(): Promise<void> {
    if (destroyed) return;
    const wanted = target();
    const focusedIndex = editor.blocks.getCurrentBlockIndex();
    const focusedId = focusedIndex >= 0 ? idAt(focusedIndex) : null;
    const focusedEl = focusedId ? blockById(focusedId)?.holder : undefined;
    const focusedHolder = focusedEl
      ? textHolders(focusedEl).find((h) => h.contains(document.activeElement) || h === document.activeElement)
      : undefined;
    const caret =
      focusedHolder && !isTextarea(focusedHolder) ? caretOffset(focusedHolder as HTMLElement) : -1;

    // Blocks this editor holds that the document doesn't. A blank paragraph is
    // Editor.js's own filler and yields; one the document *used* to have was
    // deleted by somebody and goes; anything else was written here and hasn't
    // been published yet, so it stays and is pushed up afterwards.
    const keep = new Set(wanted.map((b) => b.id));
    const mine = new Set<string>();
    for (let i = 0; i < editor.blocks.getBlocksCount(); i += 1) {
      const api = editor.blocks.getBlockByIndex(i);
      const id = api?.id;
      if (!api || !id || keep.has(id) || known.has(id)) continue;
      if (api.name === 'paragraph' && !textHolders(api.holder).some((el) => plainText(el as HTMLElement).trim())) {
        continue;
      }
      mine.add(id);
    }

    try {
      // Drop what's gone, from the end so indices behind us stay valid.
      for (let i = editor.blocks.getBlocksCount() - 1; i >= 0; i -= 1) {
        const id = idAt(i);
        if (id && !keep.has(id) && !mine.has(id)) editor.blocks.delete(i);
      }

      for (let i = 0; i < wanted.length; i += 1) {
        const block = wanted[i];
        const at = indexInEditor(block.id);
        if (at < 0) {
          editor.blocks.insert(block.type, block.data, {}, i, false, false, block.id);
          continue;
        }
        if (at !== i) editor.blocks.move(i, at);
      }

      // Trailing blocks Editor.js still holds (an empty paragraph it created on
      // mount, most often) once everything real has been placed — but not the
      // unpublished ones, which are now sitting exactly there.
      for (let i = editor.blocks.getBlocksCount() - 1; i >= wanted.length; i -= 1) {
        const id = idAt(i);
        if (!id || !mine.has(id)) editor.blocks.delete(i);
      }

      // Data changes on blocks that stayed put. Text is excluded on purpose:
      // `update()` re-renders, and re-rendering the block someone is typing in
      // is exactly what this binding exists to avoid.
      await Promise.all(
        wanted.map(async (block) => {
          const api = blockById(block.id);
          if (!api || api.name !== block.type) return;
          const fields = textFieldsOf(block.type);
          if (!fields.length) return; // structured tools are handled below
          const current = (await api.save().catch(() => null)) as { data?: unknown } | null;
          const data = (current?.data ?? {}) as Record<string, unknown>;
          const changed = Object.keys(block.data).some(
            (key) => !fields.includes(key) && !sameData(data[key], block.data[key]),
          );
          if (changed) await editor.blocks.update(block.id, block.data);
        }),
      );
    } catch {
      // Any surprise from the block API is recoverable: render the CRDT's
      // version wholesale. It costs the caret, which is why it isn't the
      // everyday path, but it can't leave the two out of step.
      await editor.blocks.render({ blocks: wanted as never }).catch(() => undefined);
    }

    // Anything rendered above arrived with the document's row ids but none of them
    // in its DOM, and the read side matches rows by that id.
    stampGrids();

    if (caret >= 0 && focusedId) {
      const back = blockById(focusedId);
      const el = back ? textHolders(back.holder)[0] : undefined;
      if (el && !isTextarea(el)) setCaretOffset(el as HTMLElement, caret);
    }
    // Whatever was kept above is in this editor and nowhere else. Publish it,
    // or the person who wrote it is the only one who will ever see it.
    if (mine.size) enqueuePull();
    onRemote?.();
  }

  /**
   * A table changed. Write the cells where they stand.
   *
   * This is the function the whole grid shape exists to make possible. Four people
   * filling in one table produce a remote update per keystroke, and the old
   * behaviour — re-render the table for each — is why editing that table together
   * felt like the page was fighting you: every remote letter put your caret back
   * at the top of the block you were typing in.
   *
   * A re-render is still the answer for a row or column appearing or going, or a
   * height being dragged, because only the tool can do those to its own DOM. Those
   * are rare, and cost one caret rather than one per keystroke.
   */
  async function renderGrid(blockId: string): Promise<void> {
    const index = indexOfId(blockId);
    if (index < 0) return;
    const map = blocks.get(index);
    const api = blockById(blockId);
    if (!api) return;
    const block = fromYBlock(map);
    if (api.name !== block.type) {
      await renderStructure();
      return;
    }

    const rows = rowsOf(map);
    const dom = gridRows(api.holder);
    if (rows && sameShape(rows, dom)) {
      stampRows(api.holder, rows);
      rows.forEach((row, r) => {
        const cells = cellsOf(row);
        const els = gridCells(dom[r]);
        cells?.forEach((cell, c) => {
          if (els[c]) writeInto(els[c], cell.toString(), blockId);
        });
      });
      onRemote?.();
      return;
    }

    await editor.blocks.update(blockId, block.data).catch(() => undefined);
    stampGrids();
    onRemote?.();
  }

  /** Structured tools (list, table, image): whole-value data, so re-render them. */
  async function renderData(blockId: string): Promise<void> {
    const index = indexOfId(blockId);
    if (index < 0) return;
    const block = fromYBlock(blocks.get(index));
    const api = blockById(blockId);
    if (!api) return;
    if (api.name !== block.type) {
      await renderStructure();
      return;
    }
    if (textFieldsOf(block.type).length) {
      await editor.blocks.update(blockId, block.data).catch(() => undefined);
      onRemote?.();
      return;
    }
    // A grid compares itself against the DOM rather than against `save()`: the
    // table tool leaves entirely-empty rows out of its saved data, so a table with
    // one blank row in it never looks equal and would re-render on every single
    // remote keystroke — exactly the caret loss this binding exists to avoid.
    if (gridFieldOf(block.type)) {
      await renderGrid(blockId);
      return;
    }
    const current = (await api.save().catch(() => null)) as { data?: unknown } | null;
    if (sameData(current?.data, block.data)) return;
    await editor.blocks.update(blockId, block.data).catch(() => undefined);
    onRemote?.();
  }

  /**
   * Re-apply a block's remote state after an IME finished a word in it.
   *
   * Whatever was held back is by now several updates old, so this re-reads the
   * document rather than replaying anything: the same two functions the observer
   * would have called, on the state as it stands.
   */
  async function refresh(blockId: string): Promise<void> {
    const index = indexOfId(blockId);
    if (index < 0) return;
    const map = blocks.get(index);
    const type = String(map.get('type') ?? '');
    if (gridFieldOf(type)) {
      await renderGrid(blockId);
      return;
    }
    for (const field of textFieldsOf(type)) applyText(blockId, field, textOf(map, field));
  }

  const enqueue = (work: () => Promise<void>): void => {
    queue = queue
      .then(async () => {
        if (destroyed) return;
        applying = true;
        try {
          await work();
        } finally {
          applying = false;
        }
        // A keystroke that landed while the editor was being written into never
        // reached the document — `pushTextFromDom` steps aside during a render.
        // Now that the editor is its own again, go and fetch it.
        if (pendingPull) {
          pendingPull = false;
          enqueuePull();
        }
      })
      .catch(() => undefined);
  };

  /**
   * `pull()`, in the same queue as the renders.
   *
   * Not merely tidy — necessary. `editor.save()` describes the editor as it is,
   * so taking that snapshot while a remote block is still waiting to be rendered
   * describes a document without it, and reconciling that would delete it for
   * everybody. Queueing means the snapshot is always taken of an editor that has
   * already caught up.
   *
   * Coalesced, because several things ask for one at once — the editor's change
   * event, a render that kept an unpublished block, every keystroke in a block
   * the document hasn't got yet. A pull reads the editor when it *runs*, so one
   * already waiting will see everything that happened since it was asked for;
   * queueing a second would only re-do the same work.
   */
  const enqueuePull = (): void => {
    if (pullQueued) return;
    pullQueued = true;
    queue = queue
      .then(() => {
        pullQueued = false;
        return destroyed ? undefined : pullNow();
      })
      .catch(() => {
        pullQueued = false;
      });
  };

  const onDeep = (events: Y.YEvent<Y.AbstractType<unknown>>[], transaction: Y.Transaction): void => {
    if (transaction.origin === LOCAL_ORIGIN || destroyed) return;
    remoteVersion += 1;

    let structural = false;
    const dataChanged = new Set<string>();
    const gridChanged = new Set<string>();
    const applied: boolean[] = [];

    for (const event of events) {
      if (event.path.length === 0) {
        structural = true;
        continue;
      }
      const index = Number(event.path[0]);
      const map = index >= 0 && index < blocks.length ? blocks.get(index) : undefined;
      const id = map ? String(map.get('id') ?? '') : '';
      if (!map || !id) {
        structural = true;
        continue;
      }
      if (event.path.length === 1) {
        // 'type' means the block became something else — that's a re-render.
        const keys = (event as unknown as Y.YMapEvent<unknown>).keysChanged;
        if (keys?.has('type')) structural = true;
        else if (keys?.size === 1 && keys.has(ROWS_KEY)) gridChanged.add(id);
        else dataChanged.add(id);
        continue;
      }
      // Inside a table: a cell typed in, a row added, a column removed, a height
      // dragged. Which of those it was doesn't need working out from the event
      // path — the grid is reconciled against the DOM as a whole, once, however
      // many of these arrived together.
      if (String(event.path[1]) === ROWS_KEY) {
        gridChanged.add(id);
        continue;
      }
      // A Y.Text — the everyday case. Written straight into the DOM, now, so
      // the caret arithmetic is done against the state the user is looking at.
      const field = String(event.path[1]);
      applying = true;
      try {
        applied.push(applyText(id, field, textOf(map, field)));
      } finally {
        applying = false;
      }
    }

    // A text change for a block this editor doesn't have yet arrives with the
    // insert that creates it; render, and the text comes with it.
    if (applied.some((ok) => !ok)) structural = true;

    // Both, when both happened: a pass that has nothing to do returns without
    // touching the editor, so ordering them costs nothing and dropping one
    // would lose a table edit that arrived alongside a new block.
    if (structural) enqueue(renderStructure);
    for (const id of dataChanged) enqueue(() => renderData(id));
    // Not when the whole structure is being rendered: that already draws the
    // table from the document, and a grid pass behind it would only re-read what
    // it just wrote.
    if (!structural) for (const id of gridChanged) enqueue(() => renderGrid(id));
    if (!structural && applied.length) onRemote?.();
  };

  // ── Wiring ───────────────────────────────────────────────────────────────

  const onInput = (event: Event): void => pushTextFromDom(event.target as Node);

  const onCompositionStart = (event: Event): void => {
    composing = holderOf(event.target as Node);
    composedIn = null;
    composedAt = null;
    if (!composing || !doc) return;

    // A composition starts at the caret and everything it goes on to produce
    // replaces only what it has produced so far, so one anchor is enough: the word
    // is an insertion at this point, whatever the keyboard does to it on the way.
    const into = yTextOf(composing);
    const start = isTextarea(composing)
      ? (composing.selectionStart ?? 0)
      : caretOffset(composing as HTMLElement);
    if (!into || start < 0) return;
    // A cell's stored value is HTML while the caret counts plain text, and the two
    // only agree when there is no markup to disagree about. Rather than guess at a
    // mapping, anchor only when they are the same string; `endComposition` has a
    // fallback for the rest.
    if (!isTextarea(composing) && composing.innerHTML !== plainText(composing)) return;

    composedIn = into;
    composedAt = Y.createRelativePositionFromTypeIndex(into, start);
    composedBase = valueOf(composing);
    composedStart = start;
  };

  /**
   * The word is finished — let go, and catch up.
   *
   * Two events lead here. `compositionend` is the ordinary one. `focusout` is the
   * escape hatch: a keyboard swapped mid-word, a phone that tore the view down, a
   * browser that simply never sent the end event — any of them would otherwise
   * leave one cell permanently unwritable, and a cell that silently stops
   * receiving other people's edits is worse than a scrambled word. Focus leaving
   * an editable ends composition in every browser, so it is a sound release even
   * when it is the only one that arrives.
   */
  const endComposition = (target: Node | null): void => {
    if (!composing) return;
    const element = composing;
    const into = composedIn;
    const anchor = composedAt;
    const base = composedBase;
    const start = composedStart;
    composing = null;
    composedIn = null;
    composedAt = null;

    const blockEl = blockElementOf(element);
    const api = blockEl ? editor.blocks.getBlockByElement(blockEl) : undefined;
    // Was a remote edit held back from this element while the word was being typed?
    const held = !!api && deferred.has(api.id);

    if (held && into && anchor && doc) {
      // The element is missing somebody else's edit, so diffing it would read their
      // text as a local deletion and take it out. Send the composed run on its own
      // instead, at the point the document says it belongs — everything either side
      // of it is theirs to keep — and let `refresh` below bring the element up to
      // date afterwards.
      const value = valueOf(element);
      const word = value.slice(start, value.length - (base.length - start));
      const at = Y.createAbsolutePositionFromRelativePosition(anchor, doc);
      if (word && at?.type === into) doc.transact(() => into.insert(at.index, word), LOCAL_ORIGIN);
    } else {
      // Nothing was held back, so the element differs from the document by exactly
      // the word just finished and the ordinary diff is exact. (Or it *was* held
      // back but couldn't be anchored — a cell with markup in it. Then this is best
      // effort: the word is kept, and the other person's edit to that same cell may
      // not be. Narrow, and better than dropping what somebody just typed.)
      pushTextFromDom(target);
    }

    if (!deferred.size) return;
    const ids = [...deferred];
    deferred.clear();
    for (const id of ids) enqueue(() => refresh(id));
  };

  const onCompositionEnd = (event: Event): void => endComposition(event.target as Node);

  const onFocusOut = (event: Event): void => {
    if (holderOf(event.target as Node) === composing) endComposition(event.target as Node);
  };

  // Capture, so it runs before anything the editor's own handlers do with the
  // event — and on the holder, so it covers every block including ones added later.
  holder.addEventListener('input', onInput, true);
  // Intermediate composition states are *not* held back from the document: a
  // half-typed word merges as cleanly as a finished one, and peers seeing it
  // appear letter by letter is the point. What must not happen is the reverse
  // write — see `writeInto`.
  holder.addEventListener('compositionstart', onCompositionStart, true);
  holder.addEventListener('compositionend', onCompositionEnd, true);
  holder.addEventListener('focusout', onFocusOut, true);
  blocks.observeDeep(onDeep);

  const ready = (async () => {
    await editor.isReady;
    if (destroyed || !blocks.length) return;
    // The editor is mounted *with* the CRDT's blocks, ids and all, so the usual
    // answer here is "nothing to do". Only a page that changed while this editor
    // was starting up needs the render — and it's worth checking rather than
    // always rendering, because a render this early would take the caret from
    // somebody who started typing straight away.
    const mounted = target();
    const inStep =
      mounted.length === editor.blocks.getBlocksCount() &&
      mounted.every((block, i) => idAt(i) === block.id);
    if (inStep) {
      // Rendered by the page rather than by us, so the rows still need naming —
      // and before the first keystroke, because a table read unnamed would look
      // like a table of brand-new rows and replace everyone else's.
      stampGrids();
      return;
    }

    applying = true;
    try {
      await editor.blocks.render({ blocks: mounted as never });
    } finally {
      applying = false;
    }
    stampGrids();
    onRemote?.();
  })();

  return {
    pull: () => {
      if (destroyed) return;
      // Mid-render, this `onChange` is almost certainly our own writing coming
      // back — but it might be a keystroke that raced it, so remember to look
      // once the render is done rather than assuming either way.
      if (applying) {
        pendingPull = true;
        return;
      }
      void ready.then(() => (destroyed ? undefined : enqueuePull()));
    },
    destroy: () => {
      destroyed = true;
      composing = null;
      holder.removeEventListener('input', onInput, true);
      holder.removeEventListener('compositionstart', onCompositionStart, true);
      holder.removeEventListener('compositionend', onCompositionEnd, true);
      holder.removeEventListener('focusout', onFocusOut, true);
      blocks.unobserveDeep(onDeep);
    },
  };
}
