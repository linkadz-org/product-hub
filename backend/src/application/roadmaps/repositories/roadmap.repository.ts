import { RoadmapEntity } from '../domain/entities/roadmap.entity';

/** The roadmap that owns an embedded item, read for a permission check only —
 *  just enough to guard on and to rank the item among related objects. */
export interface RoadmapItemOwner {
  tenantId: string;
  updatedAt: Date;
}

/** Where a backlog item lives: items are embedded, so it takes both ids. */
export interface RoadmapItemLocation {
  roadmapId: string;
  itemId: string;
}

/** Port for roadmap persistence. Tenant-scoped. */
export abstract class IRoadmapRepository {
  findById: (id: string) => Promise<RoadmapEntity | null>;
  /**
   * Locate a backlog item by its `RM-…` ref within a tenant. Items are embedded
   * in their roadmap rather than stored on their own, so this returns the pair
   * of ids needed to reach one. Null when no item holds that ref.
   */
  findItemByRef: (tenantId: string, ref: string) => Promise<RoadmapItemLocation | null>;
  /**
   * Locate the roadmap that embeds an item by the item's own `id` (not its
   * ref). Items have no independent access rule — a caller who only holds an
   * item id (e.g. reading its activity history) guards on the roadmap this
   * returns, the same way the roadmap-detail endpoint does. Null when no
   * roadmap in this tenant holds that item.
   *
   * Deliberately NOT a `RoadmapEntity`: the only callers need the two scalars
   * below (`tenantId` to guard, `updatedAt` to rank related objects), and a
   * roadmap document carries every one of its hundreds of items with their
   * descriptions. Returning the pair lets the query project, on a path that
   * runs for every roadmap-item read and every issue read that links one.
   */
  findByItemId: (tenantId: string, itemId: string) => Promise<RoadmapItemOwner | null>;
  findByPublicToken: (token: string) => Promise<RoadmapEntity | null>;
  findByTenant: (tenantId: string) => Promise<RoadmapEntity[]>;
  save: (roadmap: RoadmapEntity) => Promise<void>;
  update: (roadmap: RoadmapEntity) => Promise<void>;
  delete: (id: string) => Promise<void>;
}
