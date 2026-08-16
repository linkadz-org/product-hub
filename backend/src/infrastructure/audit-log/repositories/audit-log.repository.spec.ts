import { AuditLogRepository } from './audit-log.repository';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { AuditLogDoc } from '../entities/audit-log.schema';

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
