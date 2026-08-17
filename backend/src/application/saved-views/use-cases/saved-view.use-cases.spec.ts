import { Role } from '@core/interfaces';
import { IssueKind } from '@application/issues/domain/enums/issue.enums';
import { SavedViewEntity } from '../domain/entities/saved-view.entity';
import { ISavedViewRepository } from '../repositories/saved-view.repository';
import { SavedViewQuery, SAVED_VIEW_PER_USER_MAX } from '../domain/saved-view.types';
import {
  CreateSavedViewUseCase,
  DeleteSavedViewUseCase,
  ListSavedViewsUseCase,
  ReorderSavedViewsUseCase,
  SavedViewActor,
  UpdateSavedViewUseCase,
} from './saved-view.use-cases';

const query: SavedViewQuery = {
  kind: IssueKind.TASK,
  view: 'board',
  filters: {},
  sort: null,
  search: '',
};

const makeView = (over: Partial<Parameters<typeof SavedViewEntity.create>[0]> = {}) =>
  SavedViewEntity.create({
    tenantId: 't1',
    ownerId: 'owner',
    name: 'View',
    query,
    ...over,
  }).getValue();

/** In-memory stand-in for `ISavedViewRepository`. No MongoDB — the use-cases
 *  only depend on this interface, so a hand-rolled fake is enough to exercise
 *  every branch, including the tenant/owner scoping the real repo enforces at
 *  the query level. */
class FakeSavedViewRepository implements ISavedViewRepository {
  public rows: SavedViewEntity[] = [];

  async findVisible(tenantId: string, userId: string): Promise<SavedViewEntity[]> {
    return this.rows.filter(
      (v) => v.tenantId === tenantId && (v.ownerId === userId || v.shared),
    );
  }

  async findById(tenantId: string, id: string): Promise<SavedViewEntity | null> {
    // Deliberately NOT owner-scoped, mirroring the real repository — the
    // use-case under test is responsible for the ownership check.
    return this.rows.find((v) => v.tenantId === tenantId && v.id.toString() === id) ?? null;
  }

  async countByOwner(tenantId: string, ownerId: string): Promise<number> {
    return this.rows.filter((v) => v.tenantId === tenantId && v.ownerId === ownerId).length;
  }

  async save(view: SavedViewEntity): Promise<void> {
    const i = this.rows.findIndex((v) => v.id.toString() === view.id.toString());
    if (i === -1) this.rows.push(view);
    else this.rows[i] = view;
  }

  async delete(tenantId: string, id: string): Promise<void> {
    // Deliberately NOT owner-scoped, mirroring the real repository.
    this.rows = this.rows.filter((v) => !(v.tenantId === tenantId && v.id.toString() === id));
  }
}

const owner: SavedViewActor = { id: 'owner', role: Role.TESTER };
const nonOwner: SavedViewActor = { id: 'other', role: Role.TESTER };
const admin: SavedViewActor = { id: 'admin', role: Role.ADMIN };

describe('UpdateSavedViewUseCase permission matrix', () => {
  let repo: FakeSavedViewRepository;
  let useCase: UpdateSavedViewUseCase;

  beforeEach(() => {
    repo = new FakeSavedViewRepository();
    useCase = new UpdateSavedViewUseCase(repo);
  });

  it('owner can rename their own view', async () => {
    const view = makeView({ ownerId: 'owner', shared: false });
    repo.rows.push(view);

    const result = await useCase.execute({
      tenantId: 't1',
      id: view.id.toString(),
      actor: owner,
      dto: { name: 'Renamed' },
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().name).toBe('Renamed');
  });

  it('non-owner is denied editing a SHARED view', async () => {
    const view = makeView({ ownerId: 'owner', shared: true });
    repo.rows.push(view);

    const result = await useCase.execute({
      tenantId: 't1',
      id: view.id.toString(),
      actor: nonOwner,
      dto: { name: 'Hijacked' },
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Forbidden');
  });

  it('non-owner is denied editing a PRIVATE view', async () => {
    const view = makeView({ ownerId: 'owner', shared: false });
    repo.rows.push(view);

    const result = await useCase.execute({
      tenantId: 't1',
      id: view.id.toString(),
      actor: nonOwner,
      dto: { name: 'Hijacked' },
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Forbidden');
  });

  it("admin can edit any view, including someone else's shared view", async () => {
    const view = makeView({ ownerId: 'owner', shared: true });
    repo.rows.push(view);

    const result = await useCase.execute({
      tenantId: 't1',
      id: view.id.toString(),
      actor: admin,
      dto: { name: 'Fixed by admin' },
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().name).toBe('Fixed by admin');
  });

  it('a view from another tenant is treated as not found, not forbidden', async () => {
    const view = makeView({ tenantId: 't2', ownerId: 'owner', shared: true });
    repo.rows.push(view);

    const result = await useCase.execute({
      tenantId: 't1',
      id: view.id.toString(),
      actor: owner,
      dto: { name: 'Cross-tenant' },
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Saved view not found');
  });

  it('a missing id fails with not-found', async () => {
    const result = await useCase.execute({
      tenantId: 't1',
      id: 'does-not-exist',
      actor: owner,
      dto: { name: 'x' },
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Saved view not found');
  });
});

describe('DeleteSavedViewUseCase permission matrix', () => {
  let repo: FakeSavedViewRepository;
  let useCase: DeleteSavedViewUseCase;

  beforeEach(() => {
    repo = new FakeSavedViewRepository();
    useCase = new DeleteSavedViewUseCase(repo);
  });

  it('owner can delete their own view', async () => {
    const view = makeView({ ownerId: 'owner', shared: false });
    repo.rows.push(view);

    const result = await useCase.execute({ tenantId: 't1', id: view.id.toString(), actor: owner });

    expect(result.isSuccess).toBe(true);
    expect(repo.rows).toHaveLength(0);
  });

  it('non-owner is denied deleting a SHARED view', async () => {
    const view = makeView({ ownerId: 'owner', shared: true });
    repo.rows.push(view);

    const result = await useCase.execute({
      tenantId: 't1',
      id: view.id.toString(),
      actor: nonOwner,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Forbidden');
    expect(repo.rows).toHaveLength(1);
  });

  it('non-owner is denied deleting a PRIVATE view', async () => {
    const view = makeView({ ownerId: 'owner', shared: false });
    repo.rows.push(view);

    const result = await useCase.execute({
      tenantId: 't1',
      id: view.id.toString(),
      actor: nonOwner,
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Forbidden');
    expect(repo.rows).toHaveLength(1);
  });

  it('admin can delete any view', async () => {
    const view = makeView({ ownerId: 'owner', shared: true });
    repo.rows.push(view);

    const result = await useCase.execute({ tenantId: 't1', id: view.id.toString(), actor: admin });

    expect(result.isSuccess).toBe(true);
    expect(repo.rows).toHaveLength(0);
  });

  it('a view from another tenant is treated as not found, not deleted', async () => {
    const view = makeView({ tenantId: 't2', ownerId: 'owner', shared: true });
    repo.rows.push(view);

    const result = await useCase.execute({ tenantId: 't1', id: view.id.toString(), actor: owner });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Saved view not found');
    expect(repo.rows).toHaveLength(1);
  });
});

describe('ListSavedViewsUseCase', () => {
  it('returns only own + shared views, scoped to tenant, sorted', async () => {
    const repo = new FakeSavedViewRepository();
    const mine = makeView({ ownerId: 'owner', name: 'Mine', shared: false, order: 0 });
    const othersShared = makeView({ ownerId: 'other', name: 'Shared', shared: true });
    const othersPrivate = makeView({ ownerId: 'other', name: 'Private', shared: false });
    const otherTenant = makeView({ tenantId: 't2', ownerId: 'owner', name: 'Other tenant', shared: true });
    repo.rows.push(mine, othersShared, othersPrivate, otherTenant);

    const useCase = new ListSavedViewsUseCase(repo);
    const result = await useCase.execute({ tenantId: 't1', actor: owner });

    expect(result.isSuccess).toBe(true);
    const names = result.getValue().map((v) => v.name);
    expect(names).toEqual(['Mine', 'Shared']);
  });
});

describe('CreateSavedViewUseCase', () => {
  it('creates a view for the actor as owner', async () => {
    const repo = new FakeSavedViewRepository();
    const useCase = new CreateSavedViewUseCase(repo);

    const result = await useCase.execute({
      tenantId: 't1',
      actor: owner,
      dto: { name: 'New view', query },
    });

    expect(result.isSuccess).toBe(true);
    expect(result.getValue().ownerId).toBe('owner');
    expect(repo.rows).toHaveLength(1);
  });

  it('allows creating the 50th view (at the cap boundary)', async () => {
    const repo = new FakeSavedViewRepository();
    for (let i = 0; i < SAVED_VIEW_PER_USER_MAX - 1; i++) {
      repo.rows.push(makeView({ ownerId: 'owner', name: `V${i}` }));
    }
    expect(repo.rows).toHaveLength(49);

    const useCase = new CreateSavedViewUseCase(repo);
    const result = await useCase.execute({
      tenantId: 't1',
      actor: owner,
      dto: { name: '50th view', query },
    });

    expect(result.isSuccess).toBe(true);
    expect(repo.rows).toHaveLength(50);
  });

  it('rejects creating the 51st view for the same owner', async () => {
    const repo = new FakeSavedViewRepository();
    for (let i = 0; i < SAVED_VIEW_PER_USER_MAX; i++) {
      repo.rows.push(makeView({ ownerId: 'owner', name: `V${i}` }));
    }
    expect(repo.rows).toHaveLength(50);

    const useCase = new CreateSavedViewUseCase(repo);
    const result = await useCase.execute({
      tenantId: 't1',
      actor: owner,
      dto: { name: '51st view', query },
    });

    expect(result.isFailure).toBe(true);
    expect(result.error).toBe('Saved view limit reached');
    expect(repo.rows).toHaveLength(50);
  });

  it('the cap is per-owner, not per-tenant: another user can still create', async () => {
    const repo = new FakeSavedViewRepository();
    for (let i = 0; i < SAVED_VIEW_PER_USER_MAX; i++) {
      repo.rows.push(makeView({ ownerId: 'owner', name: `V${i}` }));
    }

    const useCase = new CreateSavedViewUseCase(repo);
    const result = await useCase.execute({
      tenantId: 't1',
      actor: nonOwner,
      dto: { name: 'Fresh view', query },
    });

    expect(result.isSuccess).toBe(true);
  });
});

describe('ReorderSavedViewsUseCase', () => {
  it('reorders only the ids the actor owns, ignoring ids for other owners', async () => {
    const repo = new FakeSavedViewRepository();
    const a = makeView({ ownerId: 'owner', name: 'A', order: 0 });
    const b = makeView({ ownerId: 'owner', name: 'B', order: 1 });
    const othersShared = makeView({ ownerId: 'other', name: 'Zulu', shared: true, order: 0 });
    repo.rows.push(a, b, othersShared);

    const useCase = new ReorderSavedViewsUseCase(repo);
    // Reverse mine (b before a), plus a stray id for someone else's shared view.
    const result = await useCase.execute({
      tenantId: 't1',
      actor: owner,
      ids: [b.id.toString(), a.id.toString(), othersShared.id.toString()],
    });

    expect(result.isSuccess).toBe(true);
    expect(b.order).toBe(0);
    expect(a.order).toBe(1);
    // The other owner's view must be untouched — order stays 0, ownerId stays theirs.
    expect(othersShared.order).toBe(0);
    expect(result.getValue().map((v) => v.name)).toEqual(['B', 'A', 'Zulu']);
  });

  it("ignores an id for another user's PRIVATE view — untouched, absent from the result", async () => {
    const repo = new FakeSavedViewRepository();
    const a = makeView({ ownerId: 'owner', name: 'A', order: 0 });
    const othersPrivate = makeView({ ownerId: 'other', name: 'Private', shared: false, order: 3 });
    repo.rows.push(a, othersPrivate);

    const useCase = new ReorderSavedViewsUseCase(repo);
    const result = await useCase.execute({
      tenantId: 't1',
      actor: owner,
      ids: [othersPrivate.id.toString(), a.id.toString()],
    });

    expect(result.isSuccess).toBe(true);
    // Untouched: neither its order nor its ownership changed.
    expect(othersPrivate.order).toBe(3);
    expect(othersPrivate.ownerId).toBe('other');
    // Not even visible to this actor (private, not theirs), so it can't appear
    // in the returned list at all.
    expect(result.getValue().map((v) => v.name)).toEqual(['A']);
  });

  it('ignores an id for a view in a DIFFERENT tenant — untouched, absent from the result', async () => {
    const repo = new FakeSavedViewRepository();
    const a = makeView({ ownerId: 'owner', name: 'A', order: 0 });
    const otherTenant = makeView({
      tenantId: 't2',
      ownerId: 'owner',
      name: 'Other tenant',
      order: 3,
    });
    repo.rows.push(a, otherTenant);

    const useCase = new ReorderSavedViewsUseCase(repo);
    const result = await useCase.execute({
      tenantId: 't1',
      actor: owner,
      ids: [otherTenant.id.toString(), a.id.toString()],
    });

    expect(result.isSuccess).toBe(true);
    // Untouched: `findVisible` never returns a cross-tenant row, so this id
    // never enters `mine` regardless of ownerId matching.
    expect(otherTenant.order).toBe(3);
    expect(otherTenant.tenantId).toBe('t2');
    expect(result.getValue().map((v) => v.name)).toEqual(['A']);
  });

  it('de-duplicates a repeated id instead of consuming two order slots', async () => {
    const repo = new FakeSavedViewRepository();
    const a = makeView({ ownerId: 'owner', name: 'A', order: 0 });
    const b = makeView({ ownerId: 'owner', name: 'B', order: 1 });
    repo.rows.push(a, b);

    const useCase = new ReorderSavedViewsUseCase(repo);
    // `a` requested twice — without de-duplication this would consume slots 0
    // and 1, pushing `b` to order 2 instead of 1.
    const result = await useCase.execute({
      tenantId: 't1',
      actor: owner,
      ids: [a.id.toString(), a.id.toString(), b.id.toString()],
    });

    expect(result.isSuccess).toBe(true);
    expect(a.order).toBe(0);
    expect(b.order).toBe(1);
    expect(result.getValue().map((v) => v.name)).toEqual(['A', 'B']);
  });
});
