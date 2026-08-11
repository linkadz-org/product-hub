import { UniqueEntityID } from '@core/domain';
import { IssueKind } from '@application/issues/domain/enums/issue.enums';
import { SavedViewEntity } from '@application/saved-views/domain/entities/saved-view.entity';
import { SavedViewQuery } from '@application/saved-views/domain/saved-view.types';
import { SavedViewRepository } from './saved-view.repository';
import { SavedViewDoc } from '../entities/saved-view.schema';

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
    // A resolved date range, not a preset — "This week" would silently mean a
    // different range the next time the view is opened.
    createdAt: ['2026-08-01..2026-08-07'],
  },
  sort: { field: 'priority', dir: 'desc' },
  search: 'login',
};

describe('SavedViewRepository toDomain/toDocument round trip', () => {
  // Exercise the mapper functions directly, without a live Mongo connection —
  // toDomain/toDocument are pure, so no InjectModel/model instance is needed.
  const repo = Object.create(SavedViewRepository.prototype) as SavedViewRepository;

  it('round-trips a view with an empty filter set', () => {
    const created = SavedViewEntity.create(
      {
        tenantId: 'tenant-1',
        ownerId: 'user-1',
        name: 'All tasks',
        query: emptyQuery,
      },
      new UniqueEntityID('view-1'),
    ).getValue();

    const doc = repo.toDocument(created) as SavedViewDoc;
    expect(doc).toMatchObject({
      _id: 'view-1',
      tenantId: 'tenant-1',
      ownerId: 'user-1',
      name: 'All tasks',
      icon: '',
      color: null,
      scope: 'issues',
      shared: false,
      schemaVersion: 1,
      order: 0,
      query: emptyQuery,
    });

    const rehydrated = repo.toDomain(doc);
    expect(rehydrated.id.toString()).toBe('view-1');
    expect(rehydrated.tenantId).toBe('tenant-1');
    expect(rehydrated.ownerId).toBe('user-1');
    expect(rehydrated.name).toBe('All tasks');
    expect(rehydrated.query).toEqual(emptyQuery);
    expect(rehydrated.query.filters).toEqual({});
  });

  it('round-trips a view with a resolved date range filter', () => {
    const created = SavedViewEntity.create(
      {
        tenantId: 'tenant-1',
        ownerId: 'user-2',
        name: 'Bugs this week',
        icon: 'bug',
        color: '#ff0000',
        shared: true,
        order: 3,
        query: dateRangeQuery,
      },
      new UniqueEntityID('view-2'),
    ).getValue();

    const doc = repo.toDocument(created) as SavedViewDoc;
    const rehydrated = repo.toDomain(doc);

    expect(rehydrated.query).toEqual(dateRangeQuery);
    expect(rehydrated.query.filters.createdAt).toEqual(['2026-08-01..2026-08-07']);
    expect(rehydrated.icon).toBe('bug');
    expect(rehydrated.color).toBe('#ff0000');
    expect(rehydrated.shared).toBe(true);
    expect(rehydrated.order).toBe(3);
  });
});
