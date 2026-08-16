import { diffRoadmapItems } from './roadmap-item-diff';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'it1',
  shortId: 'RM-AAA',
  title: 'Login redesign',
  phase: 'now',
  assignees: [],
  ...over,
}) as never;

describe('diffRoadmapItems', () => {
  it('reports a phase move', () => {
    const out = diffRoadmapItems([item()], [item({ phase: 'done' })]);
    expect(out).toEqual([
      {
        itemId: 'it1',
        itemRef: 'RM-AAA',
        changes: [{ field: 'phase', oldValue: 'now', newValue: 'done' }],
      },
    ]);
  });

  it('IGNORES pure reordering — this is the whole point', () => {
    // One drag rewrites the entire array. Without this, moving a single item
    // emits a row for every other item that did not change at all.
    const a = item({ id: 'a', shortId: 'RM-A' });
    const b = item({ id: 'b', shortId: 'RM-B' });
    expect(diffRoadmapItems([a, b], [b, a])).toEqual([]);
  });

  it('reports an added item as created', () => {
    const out = diffRoadmapItems([], [item()]);
    expect(out[0].changes).toEqual([{ field: 'created', oldValue: '', newValue: '' }]);
  });

  it('reports a removed item as deleted', () => {
    const out = diffRoadmapItems([item()], []);
    expect(out[0].changes).toEqual([{ field: 'deleted', oldValue: '', newValue: '' }]);
  });

  it('reports nothing when nothing changed', () => {
    expect(diffRoadmapItems([item()], [item()])).toEqual([]);
  });

  it('records a title change with its real values — a rename IS the event', () => {
    const out = diffRoadmapItems([item()], [item({ title: 'Something else' })]);
    expect(out[0].changes).toEqual([
      { field: 'title', oldValue: 'Login redesign', newValue: 'Something else' },
    ]);
  });
});
