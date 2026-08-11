import { SEARCH_BODY_MAX } from '../src/shared/utils/search-text.util';
import { same, TARGETS } from './backfill-search-text';

function target(name: string) {
  const t = TARGETS.find((t) => t.name === name);
  if (!t) throw new Error(`no target named ${name}`);
  return t;
}

describe('TARGETS covers every search-bearing collection', () => {
  it('has exactly the six collections carrying search fields', () => {
    expect(TARGETS.map((t) => t.name).sort()).toEqual(
      ['docpages', 'docs', 'issues', 'projects', 'reports', 'roadmaps'].sort(),
    );
  });
});

describe('issues.fields', () => {
  it('matches issue.repository.ts: buildSearchText(title, shortId)', () => {
    const out = target('issues').fields({ title: 'Đăng nhập lỗi', shortId: 'BUG-12' });
    expect(out).toEqual({ searchText: 'dang nhap loi bug-12' });
  });
});

describe('docs.fields', () => {
  it('matches doc.repository.ts: buildSearchText(title, tags.join(" "))', () => {
    const out = target('docs').fields({ title: 'Hướng dẫn', tags: ['api', 'onboarding'] });
    expect(out).toEqual({ searchText: 'huong dan api onboarding' });
  });

  it('tolerates a missing tags array', () => {
    const out = target('docs').fields({ title: 'Hướng dẫn' });
    expect(out).toEqual({ searchText: 'huong dan' });
  });
});

describe('docpages.fields', () => {
  it('matches doc-page.repository.ts: searchText from title, searchBody from plainText(content)', () => {
    const out = target('docpages').fields({
      title: 'Trang chính',
      content: '<p>Nội <b>dung</b> trang</p>',
    });
    expect(out).toEqual({
      searchText: 'trang chinh',
      searchBody: 'noi dung trang',
    });
  });

  it('caps searchBody at SEARCH_BODY_MAX characters before normalizing', () => {
    const longContent = `<p>${'a'.repeat(SEARCH_BODY_MAX + 500)}</p>`;
    const out = target('docpages').fields({ title: 't', content: longContent });
    expect((out.searchBody as string).length).toBeLessThanOrEqual(SEARCH_BODY_MAX);
  });

  it('tolerates missing content', () => {
    const out = target('docpages').fields({ title: 'Trang trống' });
    expect(out).toEqual({ searchText: 'trang trong', searchBody: '' });
  });
});

describe('projects.fields', () => {
  it('matches project.repository.ts: buildSearchText(title, subtitle)', () => {
    const out = target('projects').fields({ title: 'Sản phẩm', subtitle: 'Testing' });
    expect(out).toEqual({ searchText: 'san pham testing' });
  });
});

describe('reports.fields', () => {
  it('matches report.repository.ts: searchText from title/subtitle/module, casesSearchText from testing sections only', () => {
    const out = target('reports').fields({
      title: 'Báo cáo',
      subtitle: 'Sprint 1',
      module: 'Auth',
      sections: [
        { type: 'overview', body: 'not a testing section' },
        {
          type: 'testing',
          cases: [
            { shortId: 'TC-1', area: 'Login' },
            { shortId: 'TC-2', area: 'Đăng ký' },
          ],
        },
      ],
    });
    expect(out).toEqual({
      searchText: 'bao cao sprint 1 auth',
      casesSearchText: ['tc-1 login', 'tc-2 dang ky'],
    });
  });

  it('tolerates a report with no sections', () => {
    const out = target('reports').fields({ title: 'Rỗng', subtitle: '', module: '' });
    expect(out).toEqual({ searchText: 'rong', casesSearchText: [] });
  });
});

describe('roadmaps.fields', () => {
  it('matches roadmap.repository.ts: searchText from title/description, itemsSearchText per item', () => {
    const out = target('roadmaps').fields({
      title: 'Lộ trình Q3',
      description: 'Kế hoạch quý 3',
      items: [
        { title: 'Tính năng A', shortId: 'RM-1' },
        { title: 'Tính năng B', shortId: 'RM-2' },
      ],
    });
    expect(out).toEqual({
      searchText: 'lo trinh q3 ke hoach quy 3',
      itemsSearchText: ['tinh nang a rm-1', 'tinh nang b rm-2'],
    });
  });

  it('tolerates a roadmap with no items', () => {
    const out = target('roadmaps').fields({ title: 'Trống', description: '' });
    expect(out).toEqual({ searchText: 'trong', itemsSearchText: [] });
  });
});

describe('same', () => {
  it('is true for structurally equal values, including arrays', () => {
    expect(same({ a: 1, b: ['x', 'y'] }, { a: 1, b: ['x', 'y'] })).toBe(true);
  });

  it('is false when a computed field is stale', () => {
    expect(same('old value', 'new value')).toBe(false);
  });

  it('is false when undefined vs an empty computed string — a never-backfilled row is still stale', () => {
    expect(same(undefined, '')).toBe(false);
  });
});

describe('idempotency: applying fields twice never produces a further diff', () => {
  it.each(TARGETS.map((t) => t.name))('%s: fields(doc-with-fields-applied) === fields(doc)', (name) => {
    const t = target(name);
    const fixtures: Record<string, Record<string, unknown>> = {
      issues: { title: 'Đăng nhập lỗi', shortId: 'BUG-12' },
      docs: { title: 'Hướng dẫn', tags: ['api'] },
      docpages: { title: 'Trang', content: '<p>Nội dung</p>' },
      projects: { title: 'Sản phẩm', subtitle: 'Testing' },
      reports: {
        title: 'Báo cáo',
        subtitle: 'S1',
        module: 'Auth',
        sections: [{ type: 'testing', cases: [{ shortId: 'TC-1', area: 'Login' }] }],
      },
      roadmaps: {
        title: 'Lộ trình',
        description: 'Mô tả',
        items: [{ title: 'Item A', shortId: 'RM-1' }],
      },
    };
    const doc = fixtures[name];
    const first = t.fields(doc);
    const applied = { ...doc, ...first };
    const second = t.fields(applied);
    expect(same(first, second)).toBe(true);
  });
});
