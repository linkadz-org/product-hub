import { issueSortStage } from './issue.repository';

describe('issueSortStage', () => {
  it('is byte-for-byte the historical sort when no sort is requested', () => {
    // Every existing caller depends on this. `order` is the kanban drag position.
    expect(issueSortStage(undefined, undefined)).toEqual({ order: 1, createdAt: -1 });
  });

  it('drops `order` entirely for an ID sort', () => {
    // `order` leads and every issue has a distinct value, so leaving it in would
    // make the sort control visibly do nothing.
    const stage = issueSortStage('id', 'asc');
    expect(stage).not.toHaveProperty('order');
    expect(stage).toEqual({ refPrefix: 1, refSeq: 1, createdAt: 1 });
  });

  it('reverses every clause for a descending ID sort', () => {
    expect(issueSortStage('id', 'desc')).toEqual({ refPrefix: -1, refSeq: -1, createdAt: -1 });
  });

  it('supports created and updated sorts', () => {
    expect(issueSortStage('created', 'desc')).toEqual({ createdAt: -1 });
    expect(issueSortStage('updated', 'asc')).toEqual({ updatedAt: 1 });
  });

  it('defaults to descending when a field is given without a direction', () => {
    expect(issueSortStage('id', undefined)).toEqual({
      refPrefix: -1,
      refSeq: -1,
      createdAt: -1,
    });
  });
});
