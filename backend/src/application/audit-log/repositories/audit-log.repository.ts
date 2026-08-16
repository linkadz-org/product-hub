import { AuditLogEntity } from '../domain/entities/audit-log.entity';
import { AuditEntity } from '../domain/enums/audit.enums';
import { PaginationDto } from '@module-shared/modules/pagination/pagination.dto';

export interface AuditLogPaginationResponse {
  data: AuditLogEntity[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** One object to fetch history for. */
export interface AuditEntityRef {
  entity: AuditEntity;
  entityId: string;
}

/** Port for the append-only audit log. */
export abstract class IAuditLogRepository {
  append: (entry: AuditLogEntity) => Promise<void>;
  /** One round trip for a batch — a single update can change several fields. */
  appendMany: (entries: AuditLogEntity[]) => Promise<void>;
  findByProject: (
    tenantId: string,
    projectId: string,
    query: PaginationDto,
  ) => Promise<AuditLogPaginationResponse>;
  findByEntities: (
    tenantId: string,
    refs: AuditEntityRef[],
    query: PaginationDto,
  ) => Promise<AuditLogPaginationResponse>;
}
