import { UniqueEntityID } from '@core/domain';
import { AuditActor, AuditEntity } from '../enums/audit.enums';

export interface AuditLogProps {
  id: UniqueEntityID;
  tenantId: string;
  /** Empty for issues, doc pages and roadmap items — they have no project. */
  projectId: string;
  reportId: string;
  entity: AuditEntity;
  /** The real id of the changed object. This is what per-object history queries. */
  entityId: string;
  /** Human reference to the changed thing (case shortId / area, issue shortId). */
  entityRef: string;
  field: string;
  oldValue: string;
  newValue: string;
  actorType: AuditActor;
  actorId: string;
  actorName: string;
  /** True when this row is a consequence of one action rather than a direct edit. */
  automated: boolean;
  createdAt: Date;
}
