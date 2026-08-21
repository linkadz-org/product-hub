import { describe, expect, it } from 'vitest';
import {
  applyFilterParams,
  applySearchParam,
  filterParamName,
  readFilterParams,
} from './filterParams';

describe('readFilterParams', () => {
  it('đọc lại đúng filter đã chọn từ URL — F5 và Back không mất filter', () => {
    const filters = readFilterParams(
      new URLSearchParams('view=list&f.status=todo&f.status=doing&f.severity=high'),
    );
    expect(filters).toEqual({ status: ['todo', 'doing'], severity: ['high'] });
  });

  it('bỏ qua mọi param không mang tiền tố — kể cả param trùng tên với category', () => {
    // Đây chính là lý do có tiền tố: `/bugs?projectId=` scope cả board (đổi
    // title + back link), còn `projectId` cũng là một filter category. Chung tên
    // thì tick filter sẽ âm thầm re-scope trang.
    const filters = readFilterParams(
      new URLSearchParams('projectId=proj-1&case=Login&f.projectId=proj-2'),
    );
    expect(filters).toEqual({ projectId: ['proj-2'] });
  });

  it('không có filter nào = object rỗng, không phải key rỗng', () => {
    // FilterMenu đếm badge và hiện "Clear all" dựa trên các key có mặt, nên một
    // key với mảng rỗng sẽ hiện filter đang bật trong khi thật ra không.
    expect(readFilterParams(new URLSearchParams('view=list&sort=created'))).toEqual({});
    expect(readFilterParams(new URLSearchParams('f.status='))).toEqual({});
    expect(readFilterParams(new URLSearchParams('f.=todo'))).toEqual({});
  });

  it('giữ nguyên giá trị có dấu phẩy — vì dùng param lặp chứ không join', () => {
    // Status key do team tự đặt: một cột tên "Blocked, waiting" phải sống sót.
    const filters = readFilterParams(new URLSearchParams('f.status=Blocked%2C+waiting'));
    expect(filters).toEqual({ status: ['Blocked, waiting'] });
  });

  it('giữ nguyên date range dạng `start..end`, kể cả khi hở một đầu', () => {
    const filters = readFilterParams(
      new URLSearchParams('f.createdAt=2026-08-01..2026-08-21&f.resolvedAt=..2026-08-21'),
    );
    expect(filters).toEqual({
      createdAt: ['2026-08-01..2026-08-21'],
      resolvedAt: ['..2026-08-21'],
    });
  });

  it('category lạ vẫn được giữ, không bị vứt', () => {
    // URL sống lâu hơn code, và danh sách category phụ thuộc dữ liệu chưa load
    // xong (statuses của team, projects của workspace). Việc dọn id chết là của
    // `pruneFilters`, nơi có dữ liệu trong tay để biết nó chết thật.
    expect(readFilterParams(new URLSearchParams('f.somethingNew=x'))).toEqual({
      somethingNew: ['x'],
    });
  });
});

describe('applyFilterParams', () => {
  it('ghi filter vào URL và đọc ngược lại ra đúng cái cũ', () => {
    const params = new URLSearchParams();
    const filters = { status: ['todo', 'doing'], assigneeId: ['__unassigned__'] };
    applyFilterParams(params, filters);
    expect(readFilterParams(params)).toEqual(filters);
  });

  it('thay thế chứ không merge — bỏ tick một option là nó phải rời khỏi URL', () => {
    const params = new URLSearchParams('f.status=todo&f.status=doing&f.severity=high');
    applyFilterParams(params, { status: ['todo'] });
    expect(readFilterParams(params)).toEqual({ status: ['todo'] });
  });

  it('"Clear all" xoá sạch filter param, không đụng param khác', () => {
    const params = new URLSearchParams('kind=bug&view=list&f.status=todo&f.severity=high');
    applyFilterParams(params, {});
    expect(params.toString()).toBe('kind=bug&view=list');
  });

  it('không đụng tới param cùng tên nhưng không có tiền tố', () => {
    const params = new URLSearchParams('projectId=proj-1&f.projectId=proj-2');
    applyFilterParams(params, { projectId: ['proj-3'] });
    expect(params.get('projectId')).toBe('proj-1');
    expect(readFilterParams(params)).toEqual({ projectId: ['proj-3'] });
  });
});

describe('applySearchParam', () => {
  it('ô search rỗng thì bỏ hẳn param — trạng thái nghỉ là URL sạch', () => {
    const params = new URLSearchParams('view=list&q=login');
    applySearchParam(params, '');
    expect(params.toString()).toBe('view=list');
  });

  it('ghi rồi đọc lại nguyên văn', () => {
    const params = new URLSearchParams();
    applySearchParam(params, 'login bug');
    expect(params.get('q')).toBe('login bug');
  });
});

describe('filterParamName', () => {
  it('tên param = tiền tố + id của category', () => {
    expect(filterParamName('status')).toBe('f.status');
  });
});
