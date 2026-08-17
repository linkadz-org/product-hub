import { buildIssueTextFilter } from './issue.repository';

describe('bộ lọc ?search= của board issues', () => {
  it('khớp không dấu qua searchText', () => {
    const or = buildIssueTextFilter('Dang Nhap');
    const onSearchText = or.find((c) => 'searchText' in c);
    expect((onSearchText!.searchText as RegExp).source).toContain('dang nhap');
  });

  it('vẫn khớp được uuid dán vào ô tìm kiếm', () => {
    expect(buildIssueTextFilter('abc').some((c) => '_id' in c)).toBe(true);
  });

  it('escape ký tự regex', () => {
    expect(() => buildIssueTextFilter('a(b')).not.toThrow();
  });
});
