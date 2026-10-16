// Paste inside a table cell.
//
// Editor.js owns paste for the whole editor, and it reads anything with more than
// one line as *blocks*: the text is split into paragraphs and inserted after the
// current block — which, from inside a cell, means after the table. A multi-line
// paste landed under the table as loose paragraphs, and the cell got nothing.
//
// A cell holds HTML, not blocks, so a paste into one is taken here instead: lines
// become `<br>`s, a list stays a list (the cell's own `rte-list`), inline marks
// and chips survive, and everything else is reduced to its text. The output stays
// inside the table tool's own `sanitize` whitelist, so nothing appears in the cell
// that the next save would strip again.
import { CHECK_LIST_CLASS } from '@/lib/editorjs';
import { CELL_LIST_CLASS } from './listMarkup';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline marks, folded onto the one spelling each that `INLINE_SANITIZE` keeps. */
const MARKS: Record<string, string> = {
  B: 'b',
  STRONG: 'b',
  I: 'i',
  EM: 'i',
  U: 'u',
  S: 's',
  STRIKE: 's',
  DEL: 's',
  MARK: 'mark',
};

/** Elements that end a line — the cell writes each as text followed by `<br>`. */
const BLOCKS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION',
  'ARTICLE', 'HEADER', 'FOOTER', 'ASIDE', 'FIGURE', 'FIGCAPTION', 'TABLE', 'THEAD',
  'TBODY', 'TFOOT', 'TR', 'DL', 'DT', 'DD', 'ADDRESS', 'DETAILS', 'SUMMARY', 'LI',
]);

/** Never content: dropped with everything inside them. */
const SKIP = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'HEAD', 'META', 'TITLE', 'LINK', 'NOSCRIPT', 'SVG',
  'IMG', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
]);

const SAFE_HREF = /^(https?:|mailto:|tel:|\/|#)/i;

/**
 * Pasted HTML → cell HTML. Walks the clipboard document once, writing only what a
 * cell may hold, and tracks where lines start so that block boundaries become
 * exactly one `<br>` — never a leading one, never a doubled one, and none next to
 * a list (a list already sits on its own lines).
 */
function htmlToCellHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let out = '';
  /** Nothing has been written on the current line yet. */
  let lineStart = true;
  /** A block ended; the next real content needs a `<br>` before it. */
  let pendingBreak = false;

  const flush = () => {
    if (pendingBreak && !lineStart) out += '<br>';
    if (pendingBreak) lineStart = true;
    pendingBreak = false;
  };
  const text = (value: string, keepIndent = false) => {
    // A pending break means this text opens a new line, too.
    if ((lineStart || pendingBreak) && !keepIndent) value = value.replace(/^\s+/, '');
    if (!value) return;
    flush();
    out += escapeHtml(value);
    lineStart = false;
  };
  /** Structural tags (`<ul>`, `<li>`…) — they make their own line. */
  const structure = (tag: string) => {
    pendingBreak = false;
    out += tag;
    lineStart = true;
  };
  const endBlock = () => {
    if (!lineStart) pendingBreak = true;
  };
  /** An explicit break: whatever block ended first, then this line's own `<br>`. */
  const lineBreak = () => {
    flush();
    out += '<br>';
    lineStart = true;
  };

  const walk = (node: Node, pre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      if (!pre) return text(data.replace(/\s+/g, ' '));
      // Preformatted text keeps its own line breaks, and its indentation.
      data.split('\n').forEach((line, i) => {
        if (i > 0) lineBreak();
        text(line, true);
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    const children = (inPre = pre) => el.childNodes.forEach((c) => walk(c, inPre));

    if (tag === 'BR') return lineBreak();

    if (tag === 'UL' || tag === 'OL') {
      const checklist = el.classList.contains(CHECK_LIST_CLASS);
      const name = tag === 'OL' && !checklist ? 'ol' : 'ul';
      structure(`<${name} class="${checklist ? CHECK_LIST_CLASS : CELL_LIST_CLASS}">`);
      el.childNodes.forEach((c) => {
        if (c.nodeType !== Node.ELEMENT_NODE) return;
        const li = c as HTMLElement;
        // A list inside a list without an `<li>` around it (Google Docs, some
        // wikis) is still a nested list.
        if (li.tagName === 'UL' || li.tagName === 'OL') return walk(li, pre);
        if (li.tagName !== 'LI') return;
        const checked = checklist ? ` data-checked="${li.dataset.checked === 'true'}"` : '';
        structure(`<li${checked}>`);
        li.childNodes.forEach((n) => walk(n, pre));
        structure('</li>');
      });
      structure(`</${name}>`);
      return;
    }

    if (BLOCKS.has(tag)) {
      endBlock();
      children(pre || tag === 'PRE');
      endBlock();
      return;
    }

    // Cells of a pasted table read as one line each, words kept apart.
    if (tag === 'TD' || tag === 'TH') {
      if (!lineStart) text(' ');
      return children();
    }

    if (tag === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (!SAFE_HREF.test(href)) return children();
      flush();
      out += `<a href="${escapeHtml(href)}">`;
      children();
      out += '</a>';
      return;
    }

    // The app's own chips, so a mention copied from one cell into another stays
    // a mention rather than becoming the text "@Name".
    if (tag === 'SPAN' && (el.classList.contains('rte-mention') || el.classList.contains('rte-date'))) {
      const attr = el.classList.contains('rte-mention')
        ? ` data-user-id="${escapeHtml(el.dataset.userId ?? '')}"`
        : ` data-date="${escapeHtml(el.dataset.date ?? '')}"`;
      flush();
      out += `<span class="${el.classList.contains('rte-mention') ? 'rte-mention' : 'rte-date'}"${attr}>${escapeHtml(el.textContent ?? '')}</span>`;
      lineStart = false;
      return;
    }

    if (tag === 'CODE') {
      if (pre) return children();
      flush();
      out += '<code class="inline-code">';
      children();
      out += '</code>';
      return;
    }

    let mark = MARKS[tag];
    // Google Docs wraps the *whole* clipboard in `<b style="font-weight:normal">`
    // and spells real bold as a styled `<span>`. Read the weight, not the tag.
    const weight = el.style?.fontWeight;
    if (mark === 'b' && (weight === 'normal' || weight === '400')) mark = '';
    if (!mark && tag === 'SPAN') {
      if (weight === 'bold' || Number(weight) >= 600) mark = 'b';
      else if (el.style?.fontStyle === 'italic') mark = 'i';
    }
    if (mark) {
      flush();
      out += `<${mark}>`;
      children();
      out += `</${mark}>`;
      return;
    }
    children();
  };

  doc.body.childNodes.forEach((n) => walk(n, false));
  return trimBreaks(out);
}

/** Leading and trailing breaks are clipboard noise, not lines the author wanted. */
const trimBreaks = (html: string) => html.replace(/^(\s|<br>)+/, '').replace(/(\s|<br>)+$/, '');

/** `- `, `* `, `• ` or `1. ` at the start of a pasted line. */
const LINE_MARKER = /^\s*(?:([-*•●◦▪])|(\d+)[.)])\s+(.*)$/;

/**
 * Plain text → cell HTML: one `<br>` per line, and a run of marked lines
 * (`- a`, `- b`) as the cell's own list — the same markers typing accepts.
 */
function textToCellHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let out = '';
  let list: 'ul' | 'ol' | null = null;
  /** Something was written since the last line ended. */
  let open = false;
  for (const line of lines) {
    const m = LINE_MARKER.exec(line);
    const kind = m ? (m[1] ? 'ul' : 'ol') : null;
    if (list && kind !== list) {
      out += `</${list}>`;
      list = null;
      open = false;
    }
    if (kind) {
      if (!list) {
        out += `<${kind} class="${CELL_LIST_CLASS}">`;
        list = kind;
      }
      out += `<li>${escapeHtml(m?.[3] ?? '')}</li>`;
      continue;
    }
    if (open) out += '<br>';
    out += escapeHtml(line);
    open = true;
  }
  if (list) out += `</${list}>`;
  return trimBreaks(out);
}

/** What the clipboard holds, as cell HTML. Rich content wins when it says anything. */
export function cellPasteHtml(data: DataTransfer): string {
  const html = data.getData('text/html');
  if (html) {
    const rich = htmlToCellHtml(html);
    if (rich.replace(/<[^>]*>/g, '').trim()) return rich;
  }
  return textToCellHtml(data.getData('text/plain'));
}

const isList = (n: Node | null | undefined): n is HTMLElement =>
  !!n && n.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((n as HTMLElement).tagName);

/** Where the caret should rest after `node`: the end of its last item, if it's a list. */
function caretAfter(node: Node): Range {
  const range = document.createRange();
  const lastItem = isList(node) ? node.querySelector(':scope > li:last-child') : null;
  if (lastItem) {
    range.selectNodeContents(lastItem);
    range.collapse(false);
  } else {
    range.setStartAfter(node);
    range.collapse(true);
  }
  return range;
}

/**
 * Put `html` in place of the selection. Pasting a list while the caret is
 * already in a list item continues that list — the first pasted item joins the
 * current one, the rest become its siblings — rather than nesting a whole list
 * inside one bullet (the `• ◦` shape `foldListIndents` exists to repair).
 */
function insertIntoCell(cell: HTMLElement, html: string): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!cell.contains(range.commonAncestorContainer)) return false;
  range.deleteContents();

  const fragment = range.createContextualFragment(html);
  const item = (range.startContainer.nodeType === Node.ELEMENT_NODE
    ? (range.startContainer as HTMLElement)
    : range.startContainer.parentElement
  )?.closest('li');
  const only = fragment.childNodes.length === 1 ? fragment.firstChild : null;

  let last: Node | null;
  if (item && cell.contains(item) && isList(only)) {
    const items = Array.from(only.children);
    const first = items.shift();
    const head = document.createDocumentFragment();
    while (first?.firstChild) head.appendChild(first.firstChild);
    last = head.lastChild;
    range.insertNode(head);
    let after: Element = item;
    for (const li of items) {
      after.after(li);
      after = li;
    }
    if (items.length) {
      const r = document.createRange();
      r.selectNodeContents(after);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }
  } else {
    last = fragment.lastChild;
    range.insertNode(fragment);
  }
  if (last) {
    sel.removeAllRanges();
    sel.addRange(caretAfter(last));
  }
  return true;
}

export interface CellPasteConfig {
  onChange: () => void;
}

/**
 * Take paste for every cell of a table, on its wrapper. Capture, so it runs
 * before Editor.js's own paste handler (bound on the holder, bubbling) ever sees
 * the event — the same reason every other cell key is bound in capture.
 *
 * Files are left alone: an image pasted into a cell goes on to the editor's own
 * upload handling, as it always did.
 */
export function bindCellPaste(wrap: HTMLElement, { onChange }: CellPasteConfig) {
  wrap.addEventListener(
    'paste',
    (e) => {
      const data = e.clipboardData;
      if (!data || data.files?.length) return;
      const node = window.getSelection()?.anchorNode ?? null;
      const el = node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node?.parentElement;
      const cell = el?.closest<HTMLElement>('.tc-cell') ?? null;
      if (!cell || !wrap.contains(cell)) return;
      e.preventDefault();
      e.stopPropagation();
      const html = cellPasteHtml(data);
      if (!html || !insertIntoCell(cell, html)) return;
      // What a native paste would have fired — the collaborative binding and the
      // seed-pad trimming both read the cell off `input`.
      cell.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      onChange();
    },
    true,
  );
}
