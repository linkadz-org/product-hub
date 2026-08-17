import { describe, expect, it } from 'vitest';
import { applyIssueSort, isIssueSortField, readIssueSort } from './useIssueSort';

describe('readIssueSort', () => {
  it('đọc lại đúng thứ tự đã chọn từ URL — F5 không mất sort', () => {
    const sort = readIssueSort(new URLSearchParams('view=list&sort=severity&dir=desc'), {
      severity: true,
    });
    expect(sort).toEqual({ field: 'severity', dir: 'desc' });
  });

  it('không có param nào = không sort (trạng thái nghỉ của list)', () => {
    expect(readIssueSort(new URLSearchParams('view=list'))).toBeNull();
  });

  it('mặc định desc như API, chỉ `asc` tường minh mới lật', () => {
    expect(readIssueSort(new URLSearchParams('sort=created'))).toEqual({
      field: 'created',
      dir: 'desc',
    });
    expect(readIssueSort(new URLSearchParams('sort=created&dir=xyz'))).toEqual({
      field: 'created',
      dir: 'desc',
    });
    expect(readIssueSort(new URLSearchParams('sort=created&dir=asc'))).toEqual({
      field: 'created',
      dir: 'asc',
    });
  });

  it('field lạ → coi như không sort, không bao giờ gửi xuống API', () => {
    // Query string thì người dùng sửa được và sống lâu hơn code: một link cũ
    // `?sort=priority` phải rơi về thứ tự mặc định chứ không được nổ hay đẩy giá
    // trị API từ chối.
    expect(readIssueSort(new URLSearchParams('sort=priority'))).toBeNull();
    expect(readIssueSort(new URLSearchParams('sort='))).toBeNull();
  });

  it('severity bị gate: list không offer field đó thì cũng không nhận từ URL', () => {
    // Không gate thì link sẽ âm thầm áp thứ tự mà menu không hiện ra được — tức
    // là người dùng không có đường undo.
    const params = new URLSearchParams('sort=severity&dir=desc');
    expect(readIssueSort(params)).toBeNull();
    expect(readIssueSort(params, { severity: false })).toBeNull();
    expect(readIssueSort(params, { severity: true })).toEqual({ field: 'severity', dir: 'desc' });
  });
});

describe('applyIssueSort', () => {
  it('ghi cả sort lẫn dir, giữ nguyên param khác trên URL', () => {
    const params = new URLSearchParams('view=list&cycle=current');
    applyIssueSort(params, { field: 'severity', dir: 'asc' });
    expect(params.get('sort')).toBe('severity');
    expect(params.get('dir')).toBe('asc');
    expect(params.get('view')).toBe('list');
    expect(params.get('cycle')).toBe('current');
  });

  it('không sort = xoá sạch cả hai param (URL sạch), không ghi "none"', () => {
    const params = new URLSearchParams('view=list&sort=severity&dir=desc');
    applyIssueSort(params, null);
    expect(params.has('sort')).toBe(false);
    expect(params.has('dir')).toBe(false);
    expect(params.get('view')).toBe('list');
  });

  it('đi vòng: ghi ra rồi đọc lại phải ra đúng cái đã ghi', () => {
    const params = new URLSearchParams();
    applyIssueSort(params, { field: 'updated', dir: 'asc' });
    expect(readIssueSort(params)).toEqual({ field: 'updated', dir: 'asc' });
  });
});

describe('isIssueSortField', () => {
  it('chỉ nhận đúng bốn field API hỗ trợ', () => {
    for (const field of ['id', 'created', 'updated', 'severity']) {
      expect(isIssueSortField(field)).toBe(true);
    }
    // Sản phẩm không có field `priority` — đây chính là cái saved view của client
    // cũ có thể mang theo.
    expect(isIssueSortField('priority')).toBe(false);
    expect(isIssueSortField(undefined)).toBe(false);
    expect(isIssueSortField(null)).toBe(false);
    expect(isIssueSortField(3)).toBe(false);
  });
});
