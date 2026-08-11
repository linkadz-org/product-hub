import { IssueKind } from '@application/issues/domain/enums/issue.enums';
import { SavedViewEntity } from './saved-view.entity';
import { SAVED_VIEW_NAME_MAX, SavedViewQuery } from '../saved-view.types';

const emptyQuery: SavedViewQuery = {
  kind: IssueKind.TASK,
  view: 'board',
  filters: {},
  sort: null,
  search: '',
};

const dateRangeQuery: SavedViewQuery = {
  kind: IssueKind.BUG,
  view: 'list',
  filters: {
    status: ['open', 'in-progress'],
    // A resolved date range, not a preset: "This week" would silently mean a
    // different range the next time the view is opened.
    createdAt: ['2026-08-01..2026-08-07'],
  },
  sort: { field: 'priority', dir: 'desc' },
  search: 'login',
};

describe('SavedViewEntity.create', () => {
  it('fails when tenantId is missing', () => {
    const result = SavedViewEntity.create({
      tenantId: undefined as unknown as string,
      ownerId: 'user-1',
      name: 'My view',
      query: emptyQuery,
    });
    expect(result.isFailure).toBe(true);
  });

  it('fails when name is empty', () => {
    const result = SavedViewEntity.create({
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      name: '   ',
      query: emptyQuery,
    });
    expect(result.isFailure).toBe(true);
  });

  it('fails when name exceeds the 60-character limit', () => {
    const result = SavedViewEntity.create({
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      name: 'x'.repeat(SAVED_VIEW_NAME_MAX + 1),
      query: emptyQuery,
    });
    expect(result.isFailure).toBe(true);
    expect(result.error).toContain('60');
  });

  it('accepts a name at exactly the 60-character limit', () => {
    const result = SavedViewEntity.create({
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      name: 'x'.repeat(SAVED_VIEW_NAME_MAX),
      query: emptyQuery,
    });
    expect(result.isSuccess).toBe(true);
  });

  it('trims the name and defaults scope/shared/order/schemaVersion', () => {
    const result = SavedViewEntity.create({
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      name: '  My board  ',
      query: emptyQuery,
    });
    expect(result.isSuccess).toBe(true);
    const entity = result.getValue();
    expect(entity.name).toBe('My board');
    expect(entity.scope).toBe('issues');
    expect(entity.shared).toBe(false);
    expect(entity.order).toBe(0);
    expect(entity.schemaVersion).toBe(1);
    expect(entity.icon).toBe('');
    expect(entity.color).toBeNull();
  });
});

describe('SavedViewEntity behaviour', () => {
  const build = () =>
    SavedViewEntity.create({
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      name: 'Original name',
      query: emptyQuery,
    }).getValue();

  it('rename() validates and updates the name, and bumps updatedAt', () => {
    const entity = build();
    const before = entity.updatedAt;
    const result = entity.rename('Renamed view');
    expect(result.isSuccess).toBe(true);
    expect(entity.name).toBe('Renamed view');
    expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('rename() rejects an empty name and leaves the entity untouched', () => {
    const entity = build();
    const result = entity.rename('   ');
    expect(result.isFailure).toBe(true);
    expect(entity.name).toBe('Original name');
  });

  it('rename() rejects a name over 60 characters', () => {
    const entity = build();
    const result = entity.rename('y'.repeat(SAVED_VIEW_NAME_MAX + 1));
    expect(result.isFailure).toBe(true);
    expect(entity.name).toBe('Original name');
  });

  it('setShared() flips the shared flag', () => {
    const entity = build();
    expect(entity.shared).toBe(false);
    entity.setShared(true);
    expect(entity.shared).toBe(true);
  });

  it('setQuery() replaces the stored query wholesale', () => {
    const entity = build();
    entity.setQuery(dateRangeQuery);
    expect(entity.query).toEqual(dateRangeQuery);
  });
});
