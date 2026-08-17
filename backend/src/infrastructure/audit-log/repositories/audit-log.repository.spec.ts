import { AuditLogRepository } from './audit-log.repository';
import { AuditLogEntity } from '@application/audit-log/domain/entities/audit-log.entity';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { AuditLogDoc } from '../entities/audit-log.schema';

describe('AuditLogRepository round-trip mapping', () => {
  it('round-trips entityId and automated through toDocument/toDomain', () => {
    const entity = AuditLogEntity.create({
      tenantId: 't1',
      projectId: '',
      reportId: '',
      entity: AuditEntity.ISSUE,
      entityId: 'issue-1',
      entityRef: 'QC-10',
      field: 'status',
      oldValue: 'Backlog',
      newValue: 'Done',
      actorType: AuditActor.USER,
      actorId: 'u1',
      actorName: 'Lucas',
      automated: true,
    }).getValue();

    const repo = new AuditLogRepository({} as never);
    const doc = repo.toDocument(entity);
    expect(doc.entityId).toBe('issue-1');
    expect(doc.automated).toBe(true);

    const back = repo.toDomain({
      ...doc,
      _id: entity.id.toString(),
      createdAt: entity.createdAt,
    } as AuditLogDoc);
    expect(back.entityId).toBe('issue-1');
    expect(back.automated).toBe(true);
  });
});

describe('AuditLogRepository.toDomain', () => {
  it('falls back entityId and automated to their defaults for legacy docs missing them', () => {
    // Mongoose .lean() reads (used by findByProject) do not apply schema defaults —
    // those only apply during Document hydration. So a row written before entityId
    // and automated existed comes back from the DB with those keys simply absent.
    const legacyDoc = {
      _id: 'a1',
      tenantId: 't1',
      projectId: 'p1',
      reportId: 'r1',
      entity: AuditEntity.TESTCASE,
      entityRef: 'QC-10',
      field: 'result',
      oldValue: 'Pending',
      newValue: 'Pass',
      actorType: AuditActor.USER,
      actorId: 'u1',
      actorName: 'Lucas',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      // entityId and automated intentionally absent, as a legacy doc would be.
    } as unknown as AuditLogDoc;

    const repo = new AuditLogRepository({} as never);
    const entity = repo.toDomain(legacyDoc);

    expect(entity.entityId).toBe('');
    expect(entity.automated).toBe(false);
  });
});
