import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLogEntity } from '../domain/entities/audit-log.entity';
import { AuditActor, AuditEntity } from '../domain/enums/audit.enums';
import { IAuditLogRepository } from '../repositories/audit-log.repository';

export interface ActivityActor {
  type: AuditActor;
  id: string;
  name: string;
}

export interface RecordActivityRequest {
  tenantId: string;
  entity: AuditEntity;
  entityId: string;
  entityRef: string;
  actor: ActivityActor;
  changes: { field: string; oldValue: string; newValue: string }[];
  /** True when these rows are a consequence of one action rather than direct edits. */
  automated?: boolean;
  /** Shared by every row in this batch. Defaults to one `new Date()` per call. */
  at?: Date;
  projectId?: string;
  reportId?: string;
}

/**
 * Append history rows for one action.
 *
 * Failures are swallowed on purpose: losing a history row is bad, but failing the
 * user's edit because the log could not be written is worse. The warning is what
 * makes the loss visible.
 */
@Injectable()
export class RecordActivityUseCase {
  private readonly logger = new Logger(RecordActivityUseCase.name);

  constructor(@Inject(IAuditLogRepository) private readonly audit: IAuditLogRepository) {}

  async execute(req: RecordActivityRequest): Promise<void> {
    if (!req.changes.length) return;
    // One timestamp for the whole action, so the UI can group the rows.
    const at = req.at ?? new Date();
    try {
      const rows = req.changes.map((c) =>
        AuditLogEntity.create({
          tenantId: req.tenantId,
          projectId: req.projectId ?? '',
          reportId: req.reportId ?? '',
          entity: req.entity,
          entityId: req.entityId,
          entityRef: req.entityRef,
          field: c.field,
          oldValue: c.oldValue,
          newValue: c.newValue,
          actorType: req.actor.type,
          actorId: req.actor.id,
          actorName: req.actor.name,
          automated: req.automated ?? false,
          createdAt: at,
        }).getValue(),
      );
      await this.audit.appendMany(rows);
    } catch (err) {
      this.logger.warn(
        `activity not recorded for ${req.entity}/${req.entityId}: ${String(err)}`,
      );
    }
  }
}
