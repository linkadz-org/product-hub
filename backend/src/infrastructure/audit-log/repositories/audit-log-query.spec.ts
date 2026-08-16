import { buildEntityFilter } from './audit-log.repository';
import { AuditEntity } from '@application/audit-log/domain/enums/audit.enums';

describe('buildEntityFilter', () => {
  it('bounds by tenant and matches one object', () => {
    const f = buildEntityFilter('t1', [{ entity: AuditEntity.ISSUE, entityId: 'i1' }]);
    expect(f).toEqual({
      tenantId: 't1',
      $or: [{ entity: 'issue', entityId: 'i1' }],
    });
  });

  it('matches several objects of mixed kinds in one query', () => {
    const f = buildEntityFilter('t1', [
      { entity: AuditEntity.ISSUE, entityId: 'i1' },
      { entity: AuditEntity.DOC_PAGE, entityId: 'd1' },
    ]);
    expect(f.$or).toHaveLength(2);
    expect(f.$or).toContainEqual({ entity: 'doc_page', entityId: 'd1' });
  });

  it('never produces an unbounded filter when refs are empty', () => {
    // An empty $or would be a Mongo error; an impossible match is the safe answer.
    const f = buildEntityFilter('t1', []);
    expect(f).toEqual({ tenantId: 't1', entityId: '__none__' });
  });
});
