import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GANTT_DAY, GanttChart, type GanttRow } from './GanttChart';

/**
 * The chart's **toolbar slot** — the roadmap's Gantt ↔ Calendar switch lives in
 * it, and "the switch disappeared" is the failure this file exists to catch.
 *
 * The slot has to survive all three of the chart's shapes, not just the happy
 * one: a timeline that is still loading, or that has nothing to draw, must still
 * offer the way *out* of itself. A control that vanishes exactly when the view is
 * empty strands you in the empty view.
 */

// React 18's act() needs to be told it's in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

/** Render into a detached container and hand back its text. */
function render(node: Parameters<Root['render']>[0]): string {
  act(() => {
    root.render(node);
  });
  return host.textContent ?? '';
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
});

const TOOLBAR = createElement('button', { type: 'button' }, 'SWITCH');
const ROWS: GanttRow[] = [
  {
    id: 'a',
    label: 'Item A',
    bar: { start: Date.now(), end: Date.now() + 3 * GANTT_DAY, color: 'hsl(var(--primary))' },
  },
];

describe('GanttChart toolbar slot', () => {
  it('renders beside the legend when the chart has rows', () => {
    const text = render(
      createElement(GanttChart, { rows: ROWS, labelHeader: 'Item', toolbar: TOOLBAR }),
    );
    expect(text).toContain('SWITCH');
    expect(text).toContain('Item A');
  });

  it('stays on screen while the chart is loading', () => {
    const text = render(
      createElement(GanttChart, { rows: [], labelHeader: 'Item', toolbar: TOOLBAR, isLoading: true }),
    );
    expect(text).toContain('SWITCH');
  });

  it('stays on screen when there is nothing to draw', () => {
    const text = render(
      createElement(GanttChart, {
        rows: [],
        labelHeader: 'Item',
        toolbar: TOOLBAR,
        empty: { title: 'Nothing here' },
      }),
    );
    expect(text).toContain('SWITCH');
    expect(text).toContain('Nothing here');
  });

  it('draws no header row at all when nothing was passed for one', () => {
    const text = render(createElement(GanttChart, { rows: ROWS, labelHeader: 'Item' }));
    expect(text).not.toContain('SWITCH');
  });
});

/**
 * **Double-click to date a row.** The track turns a pointer x into the day under
 * it — UTC midnight, the instant a `YYYY-MM-DD` date parses to, so the adapter's
 * `isoDay` round-trips it exactly. A double-click that lands on the row's own
 * diamond is the tail of grabbing it and must not re-date the row.
 */
describe('GanttChart double-click to date', () => {
  const realRect = HTMLElement.prototype.getBoundingClientRect;
  beforeEach(() => {
    // jsdom lays nothing out; give every box a 1000px-wide track to measure.
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 32, right: 1000, bottom: 32, x: 0, y: 0 }) as DOMRect;
  });
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = realRect;
  });

  const dblclick = (el: Element, clientX: number) =>
    act(() => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX }));
    });

  it('reports the day under the pointer on an undated row', () => {
    const picked: number[] = [];
    render(
      createElement(GanttChart, {
        labelHeader: 'Item',
        rows: [
          ...ROWS,
          { id: 'b', label: 'Undated', emptyText: 'No dates', onDayDoubleClick: (at) => picked.push(at) },
        ],
      }),
    );
    const tracks = host.querySelectorAll('[data-gantt-track]');
    dblclick(tracks[1], 500);
    expect(picked).toHaveLength(1);
    expect(picked[0] % GANTT_DAY).toBe(0);
    // Mid-track of a window that spans today → within a couple of weeks of now.
    expect(Math.abs(picked[0] - Date.now())).toBeLessThan(14 * GANTT_DAY);
  });

  it('ignores a double-click on the row’s diamond', () => {
    const picked: number[] = [];
    render(
      createElement(GanttChart, {
        labelHeader: 'Item',
        rows: [
          {
            id: 'm',
            label: 'Due only',
            marker: { at: Date.now(), color: 'red' },
            onMarkerChange: () => {},
            onDayDoubleClick: (at) => picked.push(at),
          },
        ],
      }),
    );
    dblclick(host.querySelector('[data-gantt-item]')!, 500);
    expect(picked).toHaveLength(0);
  });
});
