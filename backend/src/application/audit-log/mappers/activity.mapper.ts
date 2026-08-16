import { AuditLogEntity } from '../domain/entities/audit-log.entity';
import { ActivityEntryDto } from '../dtos/activity-entry.response.dto';

export class ActivityMapper {
  static toDto(entry: AuditLogEntity, relationLabel: string): ActivityEntryDto {
    return {
      id: entry.id.toString(),
      entity: entry.entity,
      entityId: entry.entityId,
      entityRef: entry.entityRef,
      field: entry.field,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      actorType: entry.actorType,
      actorId: entry.actorId,
      actorName: entry.actorName,
      automated: entry.automated,
      createdAt: entry.createdAt,
      relationLabel,
    };
  }

  static toDtoArray(entries: AuditLogEntity[], relationLabel: string): ActivityEntryDto[] {
    return entries.map((e) => this.toDto(e, relationLabel));
  }
}
