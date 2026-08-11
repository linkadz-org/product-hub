import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute, Role } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { SavedViewEntity } from '../domain/entities/saved-view.entity';
import { ISavedViewRepository } from '../repositories/saved-view.repository';
import { SAVED_VIEW_PER_USER_MAX, SavedViewQuery } from '../domain/saved-view.types';

export interface SavedViewActor {
  id: string;
  role: Role;
}

/** Chủ sở hữu, hoặc admin. Không có ngoại lệ nào khác — người khác dùng được
 *  view shared, nhưng không được sửa nó dưới chân chủ nhân. */
export function canMutateSavedView(
  view: { ownerId: string; shared: boolean },
  actor: SavedViewActor,
): boolean {
  return view.ownerId === actor.id || actor.role === Role.ADMIN;
}

/** View của tôi trước theo `order` của tôi; view shared của người khác xếp sau
 *  theo tên. Sắp riêng từng người cho view shared là chuyện của v2 — trộn nhiều
 *  dãy `order` của nhiều chủ khác nhau không có luật nào đọc được. */
export function sortSavedViews<T extends { ownerId: string; name: string; order: number }>(
  views: T[],
  userId: string,
): T[] {
  const mine = views.filter((v) => v.ownerId === userId).sort((a, b) => a.order - b.order);
  const theirs = views
    .filter((v) => v.ownerId !== userId)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...mine, ...theirs];
}

export interface CreateSavedViewDto {
  name: string;
  icon?: string;
  color?: string | null;
  scope?: string;
  shared?: boolean;
  query: SavedViewQuery;
}

export interface CreateSavedViewRequest {
  tenantId: string;
  actor: SavedViewActor;
  dto: CreateSavedViewDto;
}

/** Creates a saved view for `actor` as owner. Enforces the 50-per-user cap —
 *  the repository/entity have no way to see sibling views, so this is the only
 *  place the limit can be checked. */
@Injectable()
export class CreateSavedViewUseCase
  implements IUsecaseExecute<CreateSavedViewRequest, Result<SavedViewEntity>>
{
  constructor(@Inject(ISavedViewRepository) private readonly repo: ISavedViewRepository) {}

  async execute({
    tenantId,
    actor,
    dto,
  }: CreateSavedViewRequest): Promise<Result<SavedViewEntity>> {
    const count = await this.repo.countByOwner(tenantId, actor.id);
    if (count >= SAVED_VIEW_PER_USER_MAX) {
      return Result.fail('Saved view limit reached');
    }

    const created = SavedViewEntity.create({
      tenantId,
      ownerId: actor.id,
      name: dto.name,
      icon: dto.icon,
      color: dto.color,
      scope: dto.scope,
      shared: dto.shared,
      query: dto.query,
      // New views join the end of the owner's own list rather than all
      // defaulting to 0, which would leave their relative order undefined.
      order: count,
    });
    if (created.isFailure) return Result.fail(created.error as string);

    const view = created.getValue();
    await this.repo.save(view);
    return Result.ok(view);
  }
}

export interface ListSavedViewsRequest {
  tenantId: string;
  actor: SavedViewActor;
}

/** `findVisible` is already owner-or-shared scoped by construction, so no
 *  further authorisation check is needed here — just sort for display. */
@Injectable()
export class ListSavedViewsUseCase
  implements IUsecaseExecute<ListSavedViewsRequest, Result<SavedViewEntity[]>>
{
  constructor(@Inject(ISavedViewRepository) private readonly repo: ISavedViewRepository) {}

  async execute({ tenantId, actor }: ListSavedViewsRequest): Promise<Result<SavedViewEntity[]>> {
    const rows = await this.repo.findVisible(tenantId, actor.id);
    return Result.ok(sortSavedViews(rows, actor.id));
  }
}

export interface UpdateSavedViewDto {
  name?: string;
  shared?: boolean;
  query?: SavedViewQuery;
}

export interface UpdateSavedViewRequest {
  tenantId: string;
  id: string;
  actor: SavedViewActor;
  dto: UpdateSavedViewDto;
}

@Injectable()
export class UpdateSavedViewUseCase
  implements IUsecaseExecute<UpdateSavedViewRequest, Result<SavedViewEntity>>
{
  constructor(@Inject(ISavedViewRepository) private readonly repo: ISavedViewRepository) {}

  async execute({
    tenantId,
    id,
    actor,
    dto,
  }: UpdateSavedViewRequest): Promise<Result<SavedViewEntity>> {
    const view = await this.repo.findById(tenantId, id);
    if (!view || view.tenantId !== tenantId) return Result.fail('Saved view not found');

    // Ownership gate: `findById` is tenant-scoped only (not owner-scoped), so
    // this is the sole thing standing between a request and mutating another
    // user's saved view.
    if (!canMutateSavedView(view, actor)) return Result.fail('Forbidden');

    if (dto.name !== undefined) {
      const renamed = view.rename(dto.name);
      if (renamed.isFailure) return Result.fail(renamed.error as string);
    }
    if (dto.shared !== undefined) view.setShared(dto.shared);
    if (dto.query !== undefined) view.setQuery(dto.query);

    await this.repo.save(view);
    return Result.ok(view);
  }
}

export interface DeleteSavedViewRequest {
  tenantId: string;
  id: string;
  actor: SavedViewActor;
}

@Injectable()
export class DeleteSavedViewUseCase
  implements IUsecaseExecute<DeleteSavedViewRequest, Result<void>>
{
  constructor(@Inject(ISavedViewRepository) private readonly repo: ISavedViewRepository) {}

  async execute({ tenantId, id, actor }: DeleteSavedViewRequest): Promise<Result<void>> {
    const view = await this.repo.findById(tenantId, id);
    if (!view || view.tenantId !== tenantId) return Result.fail('Saved view not found');

    // Ownership gate: `delete` is tenant-scoped only (not owner-scoped), so
    // this is the sole thing standing between a request and deleting another
    // user's saved view.
    if (!canMutateSavedView(view, actor)) return Result.fail('Forbidden');

    await this.repo.delete(tenantId, id);
    return Result.ok();
  }
}

export interface ReorderSavedViewsRequest {
  tenantId: string;
  actor: SavedViewActor;
  ids: string[];
}

/** Re-assigns `order` for the ids in the given sequence — but only among views
 *  the actor owns. `order` only has meaning within one owner's own list (see
 *  `sortSavedViews`), so an id for a view the actor doesn't own is silently
 *  ignored rather than let one user reorder another user's — or a shared —
 *  view out from under them. */
@Injectable()
export class ReorderSavedViewsUseCase
  implements IUsecaseExecute<ReorderSavedViewsRequest, Result<SavedViewEntity[]>>
{
  constructor(@Inject(ISavedViewRepository) private readonly repo: ISavedViewRepository) {}

  async execute({
    tenantId,
    actor,
    ids,
  }: ReorderSavedViewsRequest): Promise<Result<SavedViewEntity[]>> {
    const rows = await this.repo.findVisible(tenantId, actor.id);
    const mine = new Map(
      rows.filter((v) => v.ownerId === actor.id).map((v) => [v.id.toString(), v]),
    );

    let order = 0;
    for (const id of ids) {
      const view = mine.get(id);
      if (!view) continue;
      view.setOrder(order);
      await this.repo.save(view);
      order += 1;
    }

    const updated = await this.repo.findVisible(tenantId, actor.id);
    return Result.ok(sortSavedViews(updated, actor.id));
  }
}
