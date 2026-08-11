import { activeProjectFilter, mapProjectRowToHit } from './project-search.repository';
import { ProjectDoc } from '../../projects/entities/project.schema';

describe('activeProjectFilter', () => {
  it('escape ký tự regex để ô tìm kiếm không làm nổ query', () => {
    const f = activeProjectFilter('t1', 'a(b');
    expect(() => new RegExp((f.searchText as RegExp).source)).not.toThrow();
    expect((f.searchText as RegExp).source).toContain('\\(');
  });

  it('không phân biệt hoa thường', () => {
    expect((activeProjectFilter('t1', 'abc').searchText as RegExp).flags).toContain('i');
  });

  it('deletedAt luôn null bất kể q là gì — không phải tham số người dùng đổi được', () => {
    expect(activeProjectFilter('t1', 'anything').deletedAt).toBeNull();
  });
});

describe('mapProjectRowToHit', () => {
  const baseRow = (overrides: Partial<ProjectDoc> = {}): ProjectDoc =>
    ({
      _id: 'proj-1',
      title: 'Mobile App',
      subtitle: 'iOS + Android',
      updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      ...overrides,
    }) as ProjectDoc;

  it('url trỏ vào /testing/:id, icon là projects', () => {
    const hit = mapProjectRowToHit(baseRow({ _id: 'proj-9' }));
    expect(hit.url).toBe('/testing/proj-9');
    expect(hit.icon).toBe('projects');
  });

  it('subtitle lấy từ field subtitle của project', () => {
    expect(mapProjectRowToHit(baseRow({ subtitle: 'Backend services' })).subtitle).toBe(
      'Backend services',
    );
  });

  it('project không có ref/shortId', () => {
    expect(mapProjectRowToHit(baseRow()).ref).toBe('');
  });

  it('map title/updatedAt trực tiếp từ row', () => {
    const updatedAt = new Date('2026-05-01T00:00:00.000Z');
    const hit = mapProjectRowToHit(baseRow({ title: 'Website', updatedAt }));
    expect(hit.title).toBe('Website');
    expect(hit.updatedAt).toBe(updatedAt);
  });
});
