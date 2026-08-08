import { issueSortStage } from './issue.repository';

describe('issueSortStage', () => {
  it('is byte-for-byte the historical sort when no sort is requested', () => {
    // Every existing caller depends on this. `order` is the kanban drag position.
    // Deliberately no `_id` tiebreak — this shape must not move.
    expect(issueSortStage(undefined, undefined)).toEqual({ order: 1, createdAt: -1 });
  });

  it('drops `order` entirely for an ID sort', () => {
    // `order` leads and every issue has a distinct value, so leaving it in would
    // make the sort control visibly do nothing.
    const stage = issueSortStage('id', 'asc');
    expect(stage).not.toHaveProperty('order');
    expect(stage).toEqual({ refPrefix: 1, refSeq: 1, createdAt: 1, _id: 1 });
  });

  it('reverses every clause for a descending ID sort', () => {
    expect(issueSortStage('id', 'desc')).toEqual({
      refPrefix: -1,
      refSeq: -1,
      createdAt: -1,
      _id: -1,
    });
  });

  it('supports created and updated sorts', () => {
    expect(issueSortStage('created', 'desc')).toEqual({ createdAt: -1, _id: -1 });
    expect(issueSortStage('updated', 'asc')).toEqual({ updatedAt: 1, _id: 1 });
  });

  it('defaults to descending when a field is given without a direction', () => {
    expect(issueSortStage('id', undefined)).toEqual({
      refPrefix: -1,
      refSeq: -1,
      createdAt: -1,
      _id: -1,
    });
  });

  // Paging is only stable if the sort is a *total* order. Legacy rows have neither
  // ref field and the bulk migration gave many of them the same `createdAt`, so
  // without the unique `_id` clause two such rows have no defined relative order
  // and a page boundary can repeat one and drop another.
  it.each([
    ['id', ['refPrefix', 'refSeq', 'createdAt', '_id']],
    ['created', ['createdAt', '_id']],
    ['updated', ['updatedAt', '_id']],
  ] as const)('ends the %s sort with the unique _id tiebreak', (sort, keys) => {
    const stage = issueSortStage(sort, 'asc');
    expect(Object.keys(stage)).toEqual([...keys]);
    // Every clause runs the same way, so one index can serve both directions.
    expect(new Set(Object.values(stage))).toEqual(new Set([1]));
  });
});
