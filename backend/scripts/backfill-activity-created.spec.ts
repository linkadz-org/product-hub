import { buildCreatedRow } from './backfill-activity-created';

describe('buildCreatedRow', () => {
  it('builds one created row from an issue document', () => {
    const row = buildCreatedRow({
      _id: 'i1',
      tenantId: 't1',
      shortId: 'QC-10',
      createdBy: 'u1',
      createdByName: 'Lucas',
      createdAt: new Date('2026-08-02T09:14:00Z'),
    } as never);

    expect(row).toMatchObject({
      tenantId: 't1',
      entity: 'issue',
      entityId: 'i1',
      entityRef: 'QC-10',
      field: 'created',
      oldValue: '',
      newValue: '',
      actorType: 'user',
      actorId: 'u1',
      actorName: 'Lucas',
      automated: false,
    });
    expect(row.createdAt).toEqual(new Date('2026-08-02T09:14:00Z'));
    // A uuid, not an ObjectId — the raw driver never runs the schema's default.
    expect(typeof row._id).toBe('string');
    expect(row._id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('falls back to the id when an issue has no shortId', () => {
    const row = buildCreatedRow({
      _id: 'i2',
      tenantId: 't1',
      shortId: '',
      createdBy: 'u1',
      createdByName: '',
      createdAt: new Date(),
    } as never);
    expect(row.entityRef).toBe('i2');
    expect(row.actorName).toBe('');
  });
});
