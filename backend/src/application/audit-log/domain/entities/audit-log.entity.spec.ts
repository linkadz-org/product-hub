import { AuditLogEntity } from './audit-log.entity';
import { AuditActor, AuditEntity } from '../enums/audit.enums';

const base = {
  tenantId: 't1',
  projectId: '',
  reportId: '',
  entity: AuditEntity.ISSUE,
  entityId: 'issue-1',
  entityRef: 'QC-10',
  field: 'status',
  oldValue: 'Backlog',
  newValue: 'In Progress',
  actorType: AuditActor.USER,
  actorId: 'u1',
  actorName: 'Lucas',
};

describe('AuditLogEntity', () => {
  it('carries entityId so a per-object query is possible', () => {
    const e = AuditLogEntity.create(base).getValue();
    expect(e.entityId).toBe('issue-1');
  });

  it('defaults automated to false', () => {
    const e = AuditLogEntity.create(base).getValue();
    expect(e.automated).toBe(false);
  });

  it('keeps automated when set', () => {
    const e = AuditLogEntity.create({ ...base, automated: true }).getValue();
    expect(e.automated).toBe(true);
  });

  it('accepts an empty projectId — issues have no project', () => {
    const e = AuditLogEntity.create(base).getValue();
    expect(e.projectId).toBe('');
  });

  it('exposes the three new entity kinds', () => {
    expect(AuditEntity.ISSUE).toBe('issue');
    expect(AuditEntity.DOC_PAGE).toBe('doc_page');
    expect(AuditEntity.ROADMAP_ITEM).toBe('roadmap_item');
  });

  it('exposes a SYSTEM actor for date-driven cascades', () => {
    // Task 18 (cycle rollover) is the only path that uses it. Without this value
    // the rollover would have to name whoever happened to load the board.
    expect(AuditActor.SYSTEM).toBe('system');
  });

  it('accepts a SYSTEM actor with no id or name', () => {
    const e = AuditLogEntity.create({
      ...base,
      actorType: AuditActor.SYSTEM,
      actorId: '',
      actorName: '',
    }).getValue();
    expect(e.actorType).toBe(AuditActor.SYSTEM);
    expect(e.actorName).toBe('');
  });
});
