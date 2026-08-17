import { Schema } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { SAVED_VIEW_NAME_MAX } from '@application/saved-views/domain/saved-view.types';
import type { SavedViewQuery } from '@application/saved-views/domain/saved-view.types';

export interface SavedViewDoc {
  _id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  icon: string;
  color: string | null;
  scope: string;
  shared: boolean;
  schemaVersion: number;
  query: SavedViewQuery;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export const SavedViewSchema = new Schema<SavedViewDoc>(
  {
    _id: { type: String, default: () => uuid() },
    tenantId: { type: String, required: true, index: true },
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: SAVED_VIEW_NAME_MAX },
    icon: { type: String, default: '' },
    color: { type: String, default: null },
    // Một giá trị ('issues') ở v1 — có sẵn để mở rộng sang team board/roadmap.
    scope: { type: String, default: 'issues', index: true },
    shared: { type: Boolean, default: false, index: true },
    // Để đổi hình dạng `query` sau này bằng hàm chuyển đổi, thay vì để view của
    // người dùng chết âm thầm.
    schemaVersion: { type: Number, default: 1 },
    query: { type: Schema.Types.Mixed, required: true } as unknown as SavedViewQuery,
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Covers findVisible's owner branch and countByOwner (the 50-per-user cap).
SavedViewSchema.index({ tenantId: 1, ownerId: 1 });
// Covers findVisible's shared branch: every shared view within the tenant.
SavedViewSchema.index({ tenantId: 1, shared: 1 });
