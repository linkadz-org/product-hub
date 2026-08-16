import { normalizeSearchText } from '@module-shared/utils/search-text.util';
import { buildIssueSearchFilter, mapIssueRowToHit } from './issue-search.repository';
import { EXACT_MATCH_SCORE } from '../search-query.util';
import { IssueDoc } from '../../issues/entities/issue.schema';

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

  it('KHÔNG có flag "i" — case-insensitivity đến từ normalizeSearchText ở cả hai đầu', () => {
    expect((buildIssueSearchFilter('t1', 'abc').searchText as RegExp).flags).not.toContain('i');
  });

  it('vẫn khớp không phân biệt hoa thường khi cả field lưu trữ lẫn q đều đi qua normalizeSearchText', () => {
    const f = buildIssueSearchFilter('t1', normalizeSearchText('AbC'));
    expect((f.searchText as RegExp).test(normalizeSearchText('Xyz AbC Def'))).toBe(true);
  });
});

describe('mapIssueRowToHit', () => {
  const baseRow = (overrides: Partial<IssueDoc> = {}): IssueDoc =>
    ({
      _id: 'issue-1',
      shortId: 'ENG-14',
      title: 'Fix login bug',
      status: 'in-progress',
      kind: 'bug',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }) as IssueDoc;

  it('cho điểm cao (EXACT_MATCH_SCORE) khi shortId khớp chính xác exactRef', () => {
    const hit = mapIssueRowToHit(baseRow({ shortId: 'ENG-14' }), 'ENG-14');
    expect(hit.score).toBe(EXACT_MATCH_SCORE);
  });

  it('cho điểm 0 khi shortId không khớp exactRef', () => {
    const hit = mapIssueRowToHit(baseRow({ shortId: 'ENG-99' }), 'ENG-14');
    expect(hit.score).toBe(0);
  });

  it('cho điểm 0 khi không có exactRef (tìm kiếm văn bản thường)', () => {
    const hit = mapIssueRowToHit(baseRow({ shortId: 'ENG-14' }), null);
    expect(hit.score).toBe(0);
  });

  it('một hit khớp exactRef có điểm cao hơn hit không khớp', () => {
    const matching = mapIssueRowToHit(baseRow({ shortId: 'ENG-14' }), 'ENG-14');
    const nonMatching = mapIssueRowToHit(baseRow({ shortId: 'ENG-99' }), 'ENG-14');
    expect(matching.score).toBeGreaterThan(nonMatching.score);
  });

  it('url và icon của bug khác với task', () => {
    const bugHit = mapIssueRowToHit(baseRow({ kind: 'bug' as IssueDoc['kind'], shortId: 'ENG-1' }), null);
    const taskHit = mapIssueRowToHit(baseRow({ kind: 'task' as IssueDoc['kind'], shortId: 'ENG-2' }), null);
    expect(bugHit.icon).toBe('bug');
    expect(taskHit.icon).toBe('tasks');
    expect(bugHit.url).toBe('/issues/ENG-1');
    expect(taskHit.url).toBe('/issues/ENG-2');
  });

  it('rơi về _id làm url khi thiếu shortId', () => {
    const hit = mapIssueRowToHit(baseRow({ shortId: '', _id: 'issue-42' }), null);
    expect(hit.url).toBe('/issues/issue-42');
    expect(hit.ref).toBe('');
  });

  it('map title/subtitle/updatedAt trực tiếp từ row', () => {
    const updatedAt = new Date('2026-03-05T10:00:00.000Z');
    const hit = mapIssueRowToHit(baseRow({ title: 'Đăng nhập lỗi', status: 'done', updatedAt }), null);
    expect(hit.title).toBe('Đăng nhập lỗi');
    expect(hit.subtitle).toBe('done');
    expect(hit.updatedAt).toBe(updatedAt);
  });
});
