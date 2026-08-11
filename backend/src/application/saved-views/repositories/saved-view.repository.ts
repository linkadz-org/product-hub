import { SavedViewEntity } from '../domain/entities/saved-view.entity';

/** Port for saved-view persistence. Every query is tenant-scoped; the caller
 * additionally scopes by owner where a view is private. */
export interface ISavedViewRepository {
  /** View của tôi + mọi view shared trong tenant. */
  findVisible(tenantId: string, userId: string): Promise<SavedViewEntity[]>;
  findById(tenantId: string, id: string): Promise<SavedViewEntity | null>;
  countByOwner(tenantId: string, ownerId: string): Promise<number>;
  save(view: SavedViewEntity): Promise<void>;
  delete(tenantId: string, id: string): Promise<void>;
}
export const ISavedViewRepository = Symbol('ISavedViewRepository');
