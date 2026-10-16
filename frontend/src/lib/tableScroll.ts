// How a wide table scrolls — shared by the editor (`ResizableTableTool`) and the
// read view (`enhanceTables`), so the same table behaves the same in both.
//
//   .rte-table-frame        position: relative; carries the state classes
//     .rte-table-scroll     the box that scrolls sideways
//       <the table>
//     .rte-table-nav        ‹ › buttons — outside the box, so they don't scroll
//
// On top of a plain `overflow-x: auto` box:
//
// - **Bleed.** A table wider than the text column breaks out of it on both
//   sides, centred on whatever pane scrolls the page, up to 90% of that pane —
//   and only scrolls past that. The box gets negative side margins
//   (`--rte-bleed-l` / `--rte-bleed-r`, together `--rte-bleed`); the table's
//   own width is written against the column (`100% - var(--rte-bleed)`), so
//   bleeding shows more of it without making it any wider.
// - **Edge fade.** While there's more table off to one side, that edge fades
//   out (`can-scroll-left` / `can-scroll-right`, a CSS mask — no colour, so it
//   works on any background in either theme).
// - **Scroll buttons**, shown on the side there's more to see.

import { t } from '@/i18n';

/** A table may break out of the column until it's this share of the page pane wide. */
const MAX_PANE_SHARE = 0.9;
/** A button press scrolls this share of the visible width — some overlap stays in view. */
const SCROLL_STEP = 0.8;

export const TABLE_FRAME_CLASS = 'rte-table-frame';
export const TABLE_SCROLL_CLASS = 'rte-table-scroll';

const CHEVRON_LEFT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
const CHEVRON_RIGHT =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

/** The nearest ancestor that clips or scrolls — a bleed may not pass its edge. */
function clippingAncestor(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (node === document.body) break;
    const style = getComputedStyle(node);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return node;
  }
  return document.documentElement;
}

/** The frame's content width — the text column, i.e. what "fits on the page" means. */
export function columnWidth(frame: HTMLElement): number {
  const style = getComputedStyle(frame);
  return frame.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/**
 * How far a box holding `wantPx` of table reaches past each side of the column:
 * centred on the page pane, never wider than `MAX_PANE_SHARE` of it, and never
 * narrower than the column (so on a phone, where the column already fills the
 * screen, nothing bleeds).
 */
function bleedFor(frame: HTMLElement, wantPx: number): { left: number; right: number } {
  const pane = clippingAncestor(frame);
  const paneLeft = pane.getBoundingClientRect().left + pane.clientLeft;
  const paneWidth = pane.clientWidth;
  const style = getComputedStyle(frame);
  const colLeft = frame.getBoundingClientRect().left + frame.clientLeft + parseFloat(style.paddingLeft);
  const colWidth = columnWidth(frame);
  const width = Math.min(wantPx, paneWidth * MAX_PANE_SHARE);
  const extra = width - colWidth;
  if (extra <= 0) return { left: 0, right: 0 };
  // The band the box must stay inside — the middle 90% of the pane.
  const bandLeft = paneLeft + (paneWidth * (1 - MAX_PANE_SHARE)) / 2;
  const bandRight = bandLeft + paneWidth * MAX_PANE_SHARE;
  const centredLeft = paneLeft + (paneWidth - width) / 2;
  // A column off-centre in its pane (a side rail open) can't always be centred
  // around; it then bleeds less on the cramped side.
  const left = Math.min(Math.max(0, colLeft - centredLeft), Math.max(0, colLeft - bandLeft), extra);
  const right = Math.min(extra - left, Math.max(0, bandRight - (colLeft + colWidth)));
  return { left: Math.floor(left), right: Math.floor(Math.max(0, right)) };
}

/** A `%` table width, written against the column rather than the bled-out box. */
export function columnRelativeWidth(pct: number): string {
  return `calc((100% - var(--rte-bleed, 0px)) * ${Math.round(pct * 10) / 1000})`;
}

/** Wraps `box` in a frame, in place. */
export function frameTableScroll(box: HTMLElement): HTMLElement {
  const frame = document.createElement('div');
  frame.className = TABLE_FRAME_CLASS;
  box.classList.add(TABLE_SCROLL_CLASS);
  box.parentNode?.insertBefore(frame, box);
  frame.appendChild(box);
  return frame;
}

function navButton(dir: 'prev' | 'next', box: HTMLElement): HTMLButtonElement {
  const label = t(dir === 'prev' ? 'editor.scrollTableLeft' : 'editor.scrollTableRight');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `rte-table-nav__btn rte-table-nav__btn--${dir}`;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.tabIndex = -1;
  button.innerHTML = dir === 'prev' ? CHEVRON_LEFT : CHEVRON_RIGHT;
  // Never take the caret out of the cell being edited.
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const step = box.clientWidth * SCROLL_STEP;
    box.scrollBy({ left: dir === 'prev' ? -step : step, behavior: 'smooth' });
  });
  return button;
}

/**
 * Keeps a frame's box and table in step: wide or not, how far it bleeds, which
 * edges fade and which buttons show. Returns a cleanup.
 */
export function trackTableScroll(
  frame: HTMLElement,
  box: HTMLElement,
  content: () => HTMLElement | null,
): () => void {
  frame.classList.add(TABLE_FRAME_CLASS);
  box.classList.add(TABLE_SCROLL_CLASS);

  frame.querySelector(':scope > .rte-table-nav')?.remove();
  const nav = document.createElement('div');
  nav.className = 'rte-table-nav';
  nav.setAttribute('contenteditable', 'false');
  const rail = document.createElement('div');
  rail.className = 'rte-table-nav__rail';
  rail.append(navButton('prev', box), navButton('next', box));
  nav.appendChild(rail);
  frame.appendChild(nav);

  const edges = () => {
    const wide = box.classList.contains('is-overflowing');
    frame.classList.toggle('can-scroll-left', wide && box.scrollLeft > 1);
    frame.classList.toggle(
      'can-scroll-right',
      wide && box.scrollLeft + box.clientWidth < box.scrollWidth - 1,
    );
  };

  let observer: ResizeObserver | null = null;
  const observed = new Set<Element>();
  /**
   * Observed lazily: the editor builds the frame before it's in the page, so
   * its pane only exists from the first update after it lands. The pane matters
   * on its own — a side panel opening narrows it without resizing the window or
   * the (centred, max-width) column.
   */
  const watch = (el: Element | null | undefined) => {
    if (!el || !observer || observed.has(el)) return;
    observer.observe(el);
    observed.add(el);
  };

  const update = () => {
    const el = content();
    if (!el) return;
    watch(el);
    if (frame.isConnected) watch(clippingAncestor(frame));
    // Measured against the column, never the box: the box widens when it
    // bleeds, and measuring it would switch the bleed straight back off.
    const wide = el.offsetWidth > columnWidth(frame) + 1;
    box.classList.toggle('is-overflowing', wide);
    const { left, right } = wide ? bleedFor(frame, el.offsetWidth) : { left: 0, right: 0 };
    frame.style.setProperty('--rte-bleed-l', `${left}px`);
    frame.style.setProperty('--rte-bleed-r', `${right}px`);
    frame.style.setProperty('--rte-bleed', `${left + right}px`);
    edges();
  };

  box.addEventListener('scroll', edges, { passive: true });
  window.addEventListener('resize', update);
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(update);
    watch(frame);
    watch(box);
  }
  update();

  return () => {
    box.removeEventListener('scroll', edges);
    window.removeEventListener('resize', update);
    observer?.disconnect();
  };
}
