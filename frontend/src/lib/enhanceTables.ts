// Lets a stored table be wider than the page in the read-only view.
//
// A `<table>` can't scroll itself, so each one is moved into a scrolling box
// inside a frame (see `lib/tableScroll`) — on the rendered DOM only, never in
// the stored HTML, the same way `enhanceCodeBlocks` adds its copy buttons.
// Without it, a table the author widened (`width:150%`, written by
// `lib/editorjs`) or one with many columns would push the whole page sideways.

import {
  columnRelativeWidth,
  frameTableScroll,
  TABLE_SCROLL_CLASS,
  trackTableScroll,
} from './tableScroll';

/** Matches the editor's `MIN_AVG_COL_PX`: the same table starts scrolling at the same width. */
const MIN_AVG_COL_PX = 120;

/** Decorates every table under `root`; returns a cleanup for the listeners it adds. */
export function enhanceTables(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  root.querySelectorAll('table').forEach((table) => {
    const parent = table.parentElement;
    if (!parent || parent.classList.contains(TABLE_SCROLL_CLASS)) return;
    const firstRow = table.querySelector('tr');
    const cols = firstRow ? firstRow.children.length : 0;
    if (cols > 1) table.style.minWidth = `${cols * MIN_AVG_COL_PX}px`;
    // A table's `%` is of the page; the box it now sits in can be wider than
    // that once it bleeds into the margins — and a table sized by its box would
    // then grow with the bleed, which would grow the bleed.
    const pct = table.style.width.endsWith('%') ? parseFloat(table.style.width) : NaN;
    table.style.width = columnRelativeWidth(pct > 0 ? pct : 100);
    const box = document.createElement('div');
    parent.insertBefore(box, table);
    box.appendChild(table);
    const frame = frameTableScroll(box);
    cleanups.push(trackTableScroll(frame, box, () => table));
  });
  return () => cleanups.forEach((fn) => fn());
}
