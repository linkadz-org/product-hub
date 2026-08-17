import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { recordRolloverActivity } from './cycle-scheduler.service';

describe('recordRolloverActivity', () => {
  it('writes one SYSTEM row per moved issue, all sharing a timestamp', async () => {
    const recorded: Record<string, unknown>[] = [];
    const activity = { execute: async (r: Record<string, unknown>) => { recorded.push(r); } };
    const at = new Date('2026-08-05T09:30:00Z');

    await recordRolloverActivity(activity as never, 't1', at, [
      { id: 'i1', shortId: 'QC-10', fromCycleId: 'c1', toCycleId: 'c2' },
      { id: 'i2', shortId: 'QC-11', fromCycleId: 'c1', toCycleId: 'c2' },
    ]);

    expect(recorded).toHaveLength(2);
    expect(recorded[0].actor).toEqual({ type: AuditActor.SYSTEM, id: '', name: '' });
    expect(recorded[0].entity).toBe(AuditEntity.ISSUE);
    expect(recorded[0].entityId).toBe('i1');
    expect(recorded[0].entityRef).toBe('QC-10');
    expect(recorded[0].automated).toBe(true);
    expect(recorded[0].at).toEqual(at);
    expect(recorded[1].at).toEqual(at);
  });

  it('records the cycle it moved from and to', async () => {
    const recorded: Record<string, unknown>[] = [];
    const activity = { execute: async (r: Record<string, unknown>) => { recorded.push(r); } };

    await recordRolloverActivity(activity as never, 't1', new Date(), [
      { id: 'i1', shortId: 'QC-10', fromCycleId: 'c1', toCycleId: 'c2' },
    ]);

    expect(recorded[0].changes).toEqual([
      { field: 'cycleId', oldValue: 'c1', newValue: 'c2' },
    ]);
  });

  it('writes nothing when no issue moved', async () => {
    const recorded: unknown[] = [];
    const activity = { execute: async (r: unknown) => { recorded.push(r); } };
    await recordRolloverActivity(activity as never, 't1', new Date(), []);
    expect(recorded).toHaveLength(0);
  });
});
