import { Schema } from 'mongoose';
import { v4 as uuid } from 'uuid';
import {
  RoadmapColumn,
  RoadmapItemData,
} from '@application/roadmaps/domain/types/roadmap-item.type';

export interface RoadmapDoc {
  _id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string;
  items: RoadmapItemData[];
  columns: RoadmapColumn[];
  publicEnabled: boolean;
  publicToken: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** `title`, đã chuẩn hoá. Xem search-text.util.ts. Repository tính field này
   *  trong `toDocument()`. */
  searchText: string;
  /** Tiêu đề các `items`, đã chuẩn hoá. Xem search-text.util.ts. Repository
   *  tính field này trong `toDocument()`. */
  itemsSearchText: string[];
}

export const RoadmapSchema = new Schema<RoadmapDoc>(
  {
    _id: { type: String, default: () => uuid() },
    tenantId: { type: String, required: true, index: true },
    projectId: { type: String, default: '' },
    title: { type: String, required: true, maxlength: 160 },
    description: { type: String, default: '' },
    items: { type: [Schema.Types.Mixed], default: [] } as unknown as RoadmapItemData[],
    columns: { type: [Schema.Types.Mixed], default: [] } as unknown as RoadmapColumn[],
    publicEnabled: { type: Boolean, default: false },
    publicToken: { type: String, default: null },
    searchText: { type: String, default: '' },
    itemsSearchText: { type: [String], default: [] },
  },
  { timestamps: true },
);

// Items are embedded, so reaching one by its own id is a query on the parent.
// Multikey, mirroring `IssueSchema.index({ tenantId: 1, 'assignees.id': 1 })`.
// Without it `findByItemId` scans every roadmap document in the tenant — on a
// path that runs for every roadmap-item activity read.
RoadmapSchema.index({ tenantId: 1, 'items.id': 1 });
RoadmapSchema.index({ tenantId: 1, searchText: 1 });
RoadmapSchema.index({ tenantId: 1, itemsSearchText: 1 });
