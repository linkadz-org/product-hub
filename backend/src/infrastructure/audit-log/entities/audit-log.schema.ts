import { Schema } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';

export interface AuditLogDoc {
  _id: string;
  tenantId: string;
  projectId: string;
  reportId: string;
  entity: AuditEntity;
  entityId: string;
  entityRef: string;
  field: string;
  oldValue: string;
  newValue: string;
  actorType: AuditActor;
  actorId: string;
  actorName: string;
  automated: boolean;
  createdAt: Date;
}

export const AuditLogSchema = new Schema<AuditLogDoc>(
  {
    _id: { type: String, default: () => uuid() },
    tenantId: { type: String, required: true, index: true },
    // Relaxed: issues, doc pages and roadmap items have no project. Existing
    // documents all carry a value, so this is backward compatible and needs
    // no data migration.
    projectId: { type: String, default: '', index: true },
    reportId: { type: String, default: '' },
    entity: { type: String, enum: Object.values(AuditEntity), required: true },
    entityId: { type: String, default: '' },
    entityRef: { type: String, default: '' },
    field: { type: String, default: '' },
    oldValue: { type: String, default: '' },
    newValue: { type: String, default: '' },
    actorType: { type: String, enum: Object.values(AuditActor), required: true },
    actorId: { type: String, default: '' },
    actorName: { type: String, default: '' },
    automated: { type: Boolean, default: false },
  },
  // Only createdAt matters — entries are immutable.
  { timestamps: { createdAt: true, updatedAt: false } },
);

// The central query: one object's history, newest first. A real seek —
// `entityId` is an equality match and `createdAt` also serves the sort order.
AuditLogSchema.index({ tenantId: 1, entity: 1, entityId: 1, createdAt: -1 });
