import { activeProjectFilter } from './project-search.repository';
import { keepReportsOfLiveProjects } from './report-search.repository';

describe('luật loại trừ', () => {
  it('project: bỏ document đã xoá mềm', () => {
    expect(activeProjectFilter('t1', 'abc').deletedAt).toEqual(null);
  });

  it('project: vẫn lọc theo tenant', () => {
    expect(activeProjectFilter('t1', 'abc').tenantId).toBe('t1');
  });

  it('report: chỉ giữ report thuộc project còn sống', () => {
    const alive = new Set(['p1']);
    const rows = [
      { _id: 'r1', projectId: 'p1' },
      { _id: 'r2', projectId: 'p-deleted' },
    ];
    expect(keepReportsOfLiveProjects(rows, alive).map((r) => r._id)).toEqual(['r1']);
  });
});
