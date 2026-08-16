import { RoadmapEntity } from '../domain/entities/roadmap.entity';

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
   */
  findByItemId: (tenantId: string, itemId: string) => Promise<RoadmapEntity | null>;
  findByPublicToken: (token: string) => Promise<RoadmapEntity | null>;
  findByTenant: (tenantId: string) => Promise<RoadmapEntity[]>;
  save: (roadmap: RoadmapEntity) => Promise<void>;
  update: (roadmap: RoadmapEntity) => Promise<void>;
  delete: (id: string) => Promise<void>;
}
