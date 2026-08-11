import { describe, expect, it } from 'vitest';
import { IssueKind } from '@/types/enums';
import { buildSavedViewQuery, pruneFilters, sanitizeSavedViewQuery } from './api';

describe('buildSavedViewQuery', () => {
  it('gói đúng năm trường board state, không thêm/bớt', () => {
    const query = buildSavedViewQuery({
      kind: IssueKind.BUG,
      view: 'list',
      filters: { severity: ['critical'] },
      sort: { field: 'created', dir: 'desc' },
      search: 'crash',
    });
    expect(query).toEqual({
      kind: IssueKind.BUG,
      view: 'list',
      filters: { severity: ['critical'] },
      sort: { field: 'created', dir: 'desc' },
      search: 'crash',
    });
  });

  it('giữ nguyên chuỗi khoảng ngày đã giải quyết thay vì diễn giải lại', () => {
    // Task 19: một khoảng ngày là MỘT entry "<start>..<end>" đã resolve —
    // build không được đụng vào nó theo bất kỳ cách nào.
    const query = buildSavedViewQuery({
      kind: IssueKind.TASK,
      view: 'board',
      filters: { createdAt: ['2026-08-04..2026-08-11'] },
      sort: null,
      search: '',
    });
    expect(query.filters.createdAt).toEqual(['2026-08-04..2026-08-11']);
  });
});

describe('sanitizeSavedViewQuery', () => {
  it('trả về mặc định an toàn khi input null/undefined', () => {
    expect(sanitizeSavedViewQuery(null)).toEqual({
      kind: IssueKind.TASK,
      view: 'board',
      filters: {},
      sort: null,
      search: '',
    });
    expect(sanitizeSavedViewQuery(undefined)).toEqual({
      kind: IssueKind.TASK,
      view: 'board',
      filters: {},
      sort: null,
      search: '',
    });
  });

  it('thiếu toàn bộ trường vẫn trả về giá trị mặc định cho từng trường, không throw', () => {
    expect(sanitizeSavedViewQuery({})).toEqual({
      kind: IssueKind.TASK,
      view: 'board',
      filters: {},
      sort: null,
      search: '',
    });
  });

  it('kind lạ (không phải "bug") rơi về task thay vì giữ giá trị rác', () => {
    expect(sanitizeSavedViewQuery({ kind: 'not-a-kind' }).kind).toBe(IssueKind.TASK);
    expect(sanitizeSavedViewQuery({ kind: 123 }).kind).toBe(IssueKind.TASK);
    expect(sanitizeSavedViewQuery({ kind: 'bug' }).kind).toBe(IssueKind.BUG);
  });

  it('view không nằm trong board/list/timeline rơi về board', () => {
    expect(sanitizeSavedViewQuery({ view: 'kanban-9000' }).view).toBe('board');
    expect(sanitizeSavedViewQuery({ view: 'timeline' }).view).toBe('timeline');
  });

  it('filters sai hình dạng (không phải Record<string,string[]>) rơi về {}', () => {
    expect(sanitizeSavedViewQuery({ filters: 'severity=critical' }).filters).toEqual({});
    expect(sanitizeSavedViewQuery({ filters: ['critical'] }).filters).toEqual({});
    expect(sanitizeSavedViewQuery({ filters: { severity: 'critical' } }).filters).toEqual({});
    expect(sanitizeSavedViewQuery({ filters: { severity: [1, 2] } }).filters).toEqual({});
    expect(sanitizeSavedViewQuery({ filters: null }).filters).toEqual({});
  });

  it('filters đúng hình dạng đi qua nguyên vẹn, kể cả entry khoảng ngày', () => {
    const filters = { severity: ['critical'], createdAt: ['2026-08-01..2026-08-08'] };
    expect(sanitizeSavedViewQuery({ filters }).filters).toEqual(filters);
  });

  it('sort sai hình dạng rơi về null thay vì làm vỡ SortMenu', () => {
    expect(sanitizeSavedViewQuery({ sort: 'created:desc' }).sort).toBeNull();
    expect(sanitizeSavedViewQuery({ sort: { field: 'created' } }).sort).toBeNull();
    expect(sanitizeSavedViewQuery({ sort: { field: 'created', dir: 'sideways' } }).sort).toBeNull();
  });

  it('sort đúng hình dạng đi qua nguyên vẹn', () => {
    expect(sanitizeSavedViewQuery({ sort: { field: 'updated', dir: 'asc' } }).sort).toEqual({
      field: 'updated',
      dir: 'asc',
    });
  });

  it('search không phải string rơi về chuỗi rỗng', () => {
    expect(sanitizeSavedViewQuery({ search: 42 }).search).toBe('');
    expect(sanitizeSavedViewQuery({ search: null }).search).toBe('');
    expect(sanitizeSavedViewQuery({ search: 'crash' }).search).toBe('crash');
  });

  it('một query hợp lệ đầy đủ đi qua không đổi', () => {
    const raw = {
      kind: 'bug',
      view: 'list',
      filters: { severity: ['critical'] },
      sort: { field: 'created', dir: 'desc' },
      search: 'crash',
    };
    expect(sanitizeSavedViewQuery(raw)).toEqual({
      kind: IssueKind.BUG,
      view: 'list',
      filters: { severity: ['critical'] },
      sort: { field: 'created', dir: 'desc' },
      search: 'crash',
    });
  });
});

describe('pruneFilters', () => {
  it('bỏ id không còn hợp lệ, giữ lại phần còn tồn tại', () => {
    const { filters, dropped } = pruneFilters(
      { projectId: ['p1', 'p2'], severity: ['critical'] },
      { projectId: new Set(['p1']) },
    );
    expect(filters).toEqual({ projectId: ['p1'], severity: ['critical'] });
    expect(dropped).toBe(true);
  });

  it('xoá hẳn category khi không còn id nào hợp lệ', () => {
    const { filters, dropped } = pruneFilters(
      { projectId: ['stale'] },
      { projectId: new Set(['p1']) },
    );
    expect(filters).toEqual({});
    expect(dropped).toBe(true);
  });

  it('category không có trong `valid` được giữ nguyên, không coi là dropped', () => {
    const { filters, dropped } = pruneFilters(
      { status: ['todo'] },
      { projectId: new Set(['p1']) },
    );
    expect(filters).toEqual({ status: ['todo'] });
    expect(dropped).toBe(false);
  });

  it('không đổi gì và dropped=false khi mọi id đều hợp lệ', () => {
    const { filters, dropped } = pruneFilters(
      { projectId: ['p1'] },
      { projectId: new Set(['p1', 'p2']) },
    );
    expect(filters).toEqual({ projectId: ['p1'] });
    expect(dropped).toBe(false);
  });
});
