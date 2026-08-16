import { ActivityMapper } from './activity.mapper';
import { AuditLogEntity } from '../domain/entities/audit-log.entity';
import { AuditActor, AuditEntity } from '../domain/enums/audit.enums';

const entry = AuditLogEntity.create({
  tenantId: 't1',
  projectId: '',
  reportId: '',
  entity: AuditEntity.ISSUE,
  entityId: 'i1',
  entityRef: 'QC-10',
  field: 'status',
  oldValue: 'Backlog',
  newValue: 'Done',
  actorType: AuditActor.API,
  actorId: 'u1',
  actorName: 'qa-runner',
  automated: true,
}).getValue();

describe('ActivityMapper', () => {
  it('maps every field flat', () => {
    const dto = ActivityMapper.toDto(entry, '');
    expect(dto).toMatchObject({
      entity: 'issue',
      entityId: 'i1',
      entityRef: 'QC-10',
      field: 'status',
      oldValue: 'Backlog',
      newValue: 'Done',
      actorType: 'api',
      actorName: 'qa-runner',
      automated: true,
      relationLabel: '',
    });
  });

  it('carries the relation label for a related object', () => {
    expect(ActivityMapper.toDto(entry, 'subtask').relationLabel).toBe('subtask');
  });
});
