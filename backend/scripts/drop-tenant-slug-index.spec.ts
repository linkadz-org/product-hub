import { classifySlugIndex, findSlugIndex, IndexInfo } from './drop-tenant-slug-index';

/** The `_id_` index every collection carries — must never be mistaken for ours. */
const ID_INDEX: IndexInfo = { name: '_id_', key: { _id: 1 } };

describe('classifySlugIndex', () => {
  it('calls the shipped sparse+unique index broken', () => {
    // This is the definition that is live on production and rejects the second
    // slug-less tenant with `dup key: { slug: null }`.
    expect(
      classifySlugIndex([
        ID_INDEX,
        { name: 'slug_1', key: { slug: 1 }, unique: true, sparse: true },
      ]),
    ).toBe('broken');
  });

  it('calls a plain unique index broken too', () => {
    // No `sparse` at all fails for exactly the same reason and needs the same
    // drop, so "broken" is defined as *not partial*, not as sparse === true.
    expect(
      classifySlugIndex([ID_INDEX, { name: 'slug_1', key: { slug: 1 }, unique: true }]),
    ).toBe('broken');
  });

  it('calls the partial index correct, so a re-run is a no-op', () => {
    expect(
      classifySlugIndex([
        ID_INDEX,
        {
          name: 'slug_1',
          key: { slug: 1 },
          unique: true,
          partialFilterExpression: { slug: { $type: 'string' } },
        },
      ]),
    ).toBe('correct');
  });

  it('reports absent when no {slug: 1} index exists', () => {
    expect(classifySlugIndex([ID_INDEX, { name: 'status_1_createdAt_-1', key: { status: 1, createdAt: -1 } }])).toBe(
      'absent',
    );
    expect(classifySlugIndex([])).toBe('absent');
  });

  it('does not match a compound index that merely starts with slug', () => {
    // Dropping someone's `{slug, status}` index because it happens to lead with
    // slug would silently remove a query plan this migration knows nothing about.
    expect(
      classifySlugIndex([{ name: 'slug_1_status_1', key: { slug: 1, status: 1 }, unique: true }]),
    ).toBe('absent');
  });

  it('reports unknown for a non-unique {slug: 1} index', () => {
    // Not the uniqueness constraint this migration replaces — a human decides.
    expect(classifySlugIndex([{ name: 'slug_1', key: { slug: 1 } }])).toBe('unknown');
  });

  it('reports unknown for a partial index filtered on something else', () => {
    expect(
      classifySlugIndex([
        {
          name: 'slug_1',
          key: { slug: 1 },
          unique: true,
          partialFilterExpression: { status: 'active' },
        },
      ]),
    ).toBe('unknown');
  });

  it('reports unknown for a partial index that is not unique', () => {
    expect(
      classifySlugIndex([
        {
          name: 'slug_1',
          key: { slug: 1 },
          partialFilterExpression: { slug: { $type: 'string' } },
        },
      ]),
    ).toBe('unknown');
  });
});

describe('findSlugIndex', () => {
  it('returns the entry so the drop can use the name Mongo actually reports', () => {
    const mine: IndexInfo = { name: 'legacy_slug_idx', key: { slug: 1 }, unique: true };
    expect(findSlugIndex([ID_INDEX, mine])).toBe(mine);
  });

  it('returns undefined when there is none', () => {
    expect(findSlugIndex([ID_INDEX])).toBeUndefined();
  });
});
