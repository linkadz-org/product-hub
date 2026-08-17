import { RecordActivityUseCase } from './record-activity.use-case';
import { AuditActor, AuditEntity } from '../domain/enums/audit.enums';
import { AuditLogEntity } from '../domain/entities/audit-log.entity';

class FakeRepo {
  rows: AuditLogEntity[] = [];
  async append(e: AuditLogEntity) { this.rows.push(e); }
  async appendMany(es: AuditLogEntity[]) { this.rows.push(...es); }
  async findByProject() { throw new Error('unused'); }
  async findByEntities() { throw new Error('unused'); }
}

const actor = { type: AuditActor.USER, id: 'u1', name: 'Lucas' };

describe('RecordActivityUseCase', () => {
  it('writes one row per change', async () => {
    const repo = new FakeRepo();
    await new RecordActivityUseCase(repo as never).execute({
      tenantId: 't1',
      entity: AuditEntity.ISSUE,
      entityId: 'i1',
      entityRef: 'QC-10',
      actor,
      changes: [
        { field: 'status', oldValue: 'Backlog', newValue: 'Done' },
        { field: 'severity', oldValue: '', newValue: 'critical' },
      ],
    });
    expect(repo.rows).toHaveLength(2);
    expect(repo.rows[0].entityId).toBe('i1');
    expect(repo.rows[0].actorName).toBe('Lucas');
  });

  it('writes nothing when there are no changes', async () => {
    const repo = new FakeRepo();
    await new RecordActivityUseCase(repo as never).execute({
      tenantId: 't1',
      entity: AuditEntity.ISSUE,
      entityId: 'i1',
      entityRef: 'QC-10',
      actor,
      changes: [],
    });
    expect(repo.rows).toHaveLength(0);
  });

  it('gives every row in one action the same timestamp', async () => {
    const repo = new FakeRepo();
    await new RecordActivityUseCase(repo as never).execute({
      tenantId: 't1',
      entity: AuditEntity.ISSUE,
      entityId: 'i1',
      entityRef: 'QC-10',
      actor,
      automated: true,
      changes: [
        { field: 'cycleId', oldValue: 'c1', newValue: 'c2' },
        { field: 'status', oldValue: 'a', newValue: 'b' },
      ],
    });
    expect(repo.rows[0].createdAt.getTime()).toBe(repo.rows[1].createdAt.getTime());
    expect(repo.rows.every((r) => r.automated)).toBe(true);
  });

  it('never lets a logging failure break the caller', async () => {
    const repo = { appendMany: async () => { throw new Error('mongo down'); } };
    await expect(
      new RecordActivityUseCase(repo as never).execute({
        tenantId: 't1',
        entity: AuditEntity.ISSUE,
        entityId: 'i1',
        entityRef: 'QC-10',
        actor,
        changes: [{ field: 'status', oldValue: 'a', newValue: 'b' }],
      }),
    ).resolves.toBeUndefined();
  });
});
