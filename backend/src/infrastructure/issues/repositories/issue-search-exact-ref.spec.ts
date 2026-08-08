import {
  exactRefSearch,
  issueSortStage,
  shouldRankExactRefFirst,
} from './issue.repository';

describe('exactRefSearch', () => {
  it('recognises a full ref and upper-cases it to how refs are stored', () => {
    expect(exactRefSearch('ENG-1')).toBe('ENG-1');
    // Case-insensitive on the ref: refs are minted upper case but retyped by hand.
    expect(exactRefSearch('eng-1')).toBe('ENG-1');
    expect(exactRefSearch('Eng-14')).toBe('ENG-14');
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(exactRefSearch('  ENG-1  ')).toBe('ENG-1');
  });

  it('returns null for anything that is not a ref', () => {
    // These take the untouched code path, so ordinary searching cannot change.
    for (const text of [
      undefined,
      '',
      '   ',
      'login',
      'ENG',
      '-1',
      'ENG-',
      'ENG-1a',
      'ENG 1',
      '1-ENG',
      'ENG-1-2',
      'fix ENG-1 crash',
      'a-very-long-prefix-1',
    ]) {
      expect(exactRefSearch(text as string | undefined)).toBeNull();
    }
  });
});

describe('shouldRankExactRefFirst', () => {
  it('floats the exact ref when the user chose no sort', () => {
    expect(shouldRankExactRefFirst('ENG-1', undefined)).toBe(true);
  });

  it('does nothing when the search text is not a ref', () => {
    expect(shouldRankExactRefFirst(null, undefined)).toBe(false);
    expect(shouldRankExactRefFirst(null, 'id')).toBe(false);
  });

  it('yields to an explicit sort the user picked', () => {
    // Pinning a row above "ID ascending" would make the sort control look broken
    // and the column header lie about the order.
    expect(shouldRankExactRefFirst('ENG-1', 'id')).toBe(false);
    expect(shouldRankExactRefFirst('ENG-1', 'created')).toBe(false);
    expect(shouldRankExactRefFirst('ENG-1', 'updated')).toBe(false);
  });
});

describe('the sort the ranked pipeline builds', () => {
  it('leads with the rank and then keeps the board default underneath', () => {
    // The exact row leads; everything else stays in the order it already had.
    expect({ __exactRefRank: 1, ...issueSortStage(undefined, undefined) }).toEqual({
      __exactRefRank: 1,
      order: 1,
      createdAt: -1,
    });
  });

  it('leaves the no-sort, no-search query byte-for-byte historical', () => {
    // The rank only exists on the aggregation branch, which a non-ref search and
    // every non-search list never take.
    expect(shouldRankExactRefFirst(exactRefSearch(undefined), undefined)).toBe(false);
    expect(issueSortStage(undefined, undefined)).toEqual({ order: 1, createdAt: -1 });
  });
});
