import {
  buildIssueSearchFilter,
  clampSearchLimit,
  SEARCH_GROUP_LIMIT_MAX,
} from './issue-search.repository';

describe('buildIssueSearchFilter', () => {
  it('lọc theo tenant và regex trên searchText', () => {
    const f = buildIssueSearchFilter('t1', 'dang nhap');
    expect(f.tenantId).toBe('t1');
    expect((f.searchText as RegExp).source).toContain('dang nhap');
  });

  it('escape ký tự regex để ô tìm kiếm không làm nổ query', () => {
    const f = buildIssueSearchFilter('t1', 'a(b');
    expect(() => new RegExp((f.searchText as RegExp).source)).not.toThrow();
    expect((f.searchText as RegExp).source).toContain('\\(');
  });

  it('không phân biệt hoa thường', () => {
    expect((buildIssueSearchFilter('t1', 'abc').searchText as RegExp).flags).toContain('i');
  });
});

describe('clampSearchLimit', () => {
  it('kẹp giá trị vượt trần về SEARCH_GROUP_LIMIT_MAX', () => {
    expect(clampSearchLimit(999)).toBe(SEARCH_GROUP_LIMIT_MAX);
  });

  it('giữ nguyên giá trị hợp lệ trong khoảng', () => {
    expect(clampSearchLimit(5)).toBe(5);
  });

  it('mặc định về trần khi limit không hợp lệ (0, âm, NaN)', () => {
    expect(clampSearchLimit(0)).toBe(SEARCH_GROUP_LIMIT_MAX);
    expect(clampSearchLimit(-3)).toBe(SEARCH_GROUP_LIMIT_MAX);
    expect(clampSearchLimit(Number.NaN)).toBe(SEARCH_GROUP_LIMIT_MAX);
  });
});
