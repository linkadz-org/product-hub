import { buildDocPageFilter, mapDocPageRowToHit } from './doc-page-search.repository';
import { DocPageDoc } from '../../docs/entities/doc-page.schema';

describe('buildDocPageFilter', () => {
  it('lọc theo tenant và khớp trên CẢ HAI field searchText và searchBody', () => {
    const f = buildDocPageFilter('t1', 'triển khai');
    expect(f.tenantId).toBe('t1');
    expect(f.$or).toEqual([
      { searchText: expect.any(RegExp) },
      { searchBody: expect.any(RegExp) },
    ]);
    expect((f.$or as { searchText: RegExp }[])[0].searchText.source).toContain('triển khai');
    expect((f.$or as { searchBody: RegExp }[])[1].searchBody.source).toContain('triển khai');
  });

  it('escape ký tự regex trên cả hai field', () => {
    const f = buildDocPageFilter('t1', 'a(b');
    const [first, second] = f.$or as [{ searchText: RegExp }, { searchBody: RegExp }];
    expect(first.searchText.source).toContain('\\(');
    expect(second.searchBody.source).toContain('\\(');
  });

  it('không phân biệt hoa thường', () => {
    const f = buildDocPageFilter('t1', 'abc');
    const [first] = f.$or as [{ searchText: RegExp }];
    expect(first.searchText.flags).toContain('i');
  });
});

describe('mapDocPageRowToHit', () => {
  const baseRow = (overrides: Partial<DocPageDoc> = {}): DocPageDoc =>
    ({
      _id: 'page-1',
      docId: 'doc-1',
      title: 'Cài đặt môi trường',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      ...overrides,
    }) as DocPageDoc;

  it('url trỏ vào /docs/:docId/:pageId (khác doc-search vốn chỉ có /docs/:id)', () => {
    const hit = mapDocPageRowToHit(baseRow({ docId: 'doc-7', _id: 'page-3' }));
    expect(hit.url).toBe('/docs/doc-7/page-3');
  });

  it('trang doc dùng chung type/icon "docs" với doc gốc', () => {
    const hit = mapDocPageRowToHit(baseRow());
    expect(hit.icon).toBe('docs');
  });

  it('page không có ref riêng', () => {
    expect(mapDocPageRowToHit(baseRow()).ref).toBe('');
  });

  it('map title/updatedAt trực tiếp từ row', () => {
    const updatedAt = new Date('2026-04-01T00:00:00.000Z');
    const hit = mapDocPageRowToHit(baseRow({ title: 'Triển khai', updatedAt }));
    expect(hit.title).toBe('Triển khai');
    expect(hit.updatedAt).toBe(updatedAt);
  });
});
