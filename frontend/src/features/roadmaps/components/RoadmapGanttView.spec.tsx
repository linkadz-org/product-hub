import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROADMAP_COLUMNS, RoadmapItemStatus } from '@/types/enums';
import type { RoadmapItem, TaskDto } from '@/types/dto';
import { RoadmapGantt, itemColor } from './RoadmapGanttView';

/**
 * **On hold on the timeline**: a parked item stays charted — work you can't see
 * is work you forget — but greyed out, under its own section, below everything
 * that's actually moving. "It's mixed in with live work" and "it vanished" are
 * the two failures this file exists to catch.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const item = (id: string, title: string, status: RoadmapItemStatus): RoadmapItem =>
  ({
    id,
    title,
    description: '',
    phase: 'now',
    status,
    progress: 0,
    rice: 0,
    assignees: [],
    okrLabel: '',
    startDate: '2026-10-01',
    endDate: '2026-10-10',
  }) as unknown as RoadmapItem;

function renderGantt(items: RoadmapItem[]) {
  act(() => {
    root.render(
      createElement(RoadmapGantt, { items, columns: DEFAULT_ROADMAP_COLUMNS, onOpenItem: () => {} }),
    );
  });
  return host.textContent ?? '';
}

describe('RoadmapGantt — on hold', () => {
  it('sinks held items below live ones, under an "On hold" section', () => {
    const text = renderGantt([
      item('a', 'Parked thing', RoadmapItemStatus.ON_HOLD),
      item('b', 'Live thing', RoadmapItemStatus.IN_PROGRESS),
    ]);
    const live = text.indexOf('Live thing');
    const section = text.indexOf('On hold');
    const parked = text.indexOf('Parked thing');
    expect(live).toBeGreaterThan(-1);
    expect(section).toBeGreaterThan(live);
    expect(parked).toBeGreaterThan(section);
  });

  it('adds no section when nothing is on hold', () => {
    const text = renderGantt([item('b', 'Live thing', RoadmapItemStatus.IN_PROGRESS)]);
    expect(text).not.toContain('On hold');
  });

  it('draws a held bar grey, whatever its chip colour', () => {
    expect(itemColor(item('a', 'x', RoadmapItemStatus.ON_HOLD))).toBe('hsl(var(--muted-foreground))');
    expect(itemColor(item('b', 'x', RoadmapItemStatus.IN_PROGRESS))).toBe('hsl(var(--info))');
  });
});

describe('RoadmapGantt — linked bugs', () => {
  const linked = (id: string, title: string) =>
    ({
      id,
      shortId: id.toUpperCase(),
      title,
      teamId: 't',
      status: 'todo',
      roadmapItemId: 'b',
      startDate: '',
      endDate: '',
      dueDate: '',
      cycleId: '',
      labelKeys: [],
      assignees: [],
    }) as unknown as TaskDto;

  it('lists a bug after the item’s tasks, tagged, and counts it apart', () => {
    act(() => {
      root.render(
        createElement(RoadmapGantt, {
          items: [item('b', 'Live thing', RoadmapItemStatus.IN_PROGRESS)],
          columns: DEFAULT_ROADMAP_COLUMNS,
          onOpenItem: () => {},
          tasksByItem: new Map([['b', [linked('bug-1', 'Crash on save'), linked('tsk-1', 'Build it')]]]),
          isBug: (tk) => tk.id === 'bug-1',
        }),
      );
    });
    const text = host.textContent ?? '';
    expect(text).toContain('1 tasks · 1 bugs');
    expect(text.indexOf('Crash on save')).toBeGreaterThan(text.indexOf('Build it'));
    expect(text).toContain('BugBUG-1');
  });
});
