import { buildDocSearchFilter, mapDocRowToHit } from './doc-search.repository';
import { DocDoc } from '../../docs/entities/doc.schema';

describe('buildDocSearchFilter', () => {
  it('lọc theo tenant và regex trên searchText', () => {
    const f = buildDocSearchFilter('t1', 'huong dan');
    expect(f.tenantId).toBe('t1');
    expect((f.searchText as RegExp).source).toContain('huong dan');
  });

  it('escape ký tự regex để ô tìm kiếm không làm nổ query', () => {
    const f = buildDocSearchFilter('t1', 'a(b');
    expect(() => new RegExp((f.searchText as RegExp).source)).not.toThrow();
    expect((f.searchText as RegExp).source).toContain('\\(');
  });

  it('không phân biệt hoa thường', () => {
    expect((buildDocSearchFilter('t1', 'abc').searchText as RegExp).flags).toContain('i');
  });
});

describe('mapDocRowToHit', () => {
  const baseRow = (overrides: Partial<DocDoc> = {}): DocDoc =>
    ({
      _id: 'doc-1',
      ref: 'DOC-6HCUHKX',
      title: 'Onboarding guide',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      ...overrides,
    }) as DocDoc;

  it('map id/title/updatedAt trực tiếp từ row', () => {
    const updatedAt = new Date('2026-03-05T10:00:00.000Z');
    const hit = mapDocRowToHit(baseRow({ title: 'Hướng dẫn', updatedAt }));
    expect(hit.id).toBe('doc-1');
    expect(hit.title).toBe('Hướng dẫn');
    expect(hit.updatedAt).toBe(updatedAt);
  });

  it('dùng ref của doc, icon là docs, url trỏ vào /docs/:id', () => {
    const hit = mapDocRowToHit(baseRow({ ref: 'DOC-6HCUHKX', _id: 'doc-9' }));
    expect(hit.ref).toBe('DOC-6HCUHKX');
    expect(hit.icon).toBe('docs');
    expect(hit.url).toBe('/docs/doc-9');
  });

  it('ref rỗng khi doc chưa có ref (được tạo trước khi tính năng ref tồn tại)', () => {
    const hit = mapDocRowToHit(baseRow({ ref: '' }));
    expect(hit.ref).toBe('');
  });

  it('score luôn 0 — doc không có khái niệm exact ref match', () => {
    expect(mapDocRowToHit(baseRow()).score).toBe(0);
  });
});
