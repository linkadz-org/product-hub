import { describe, expect, it } from 'vitest';
import type { SearchGroupDto, SearchHitDto } from '@/types/dto';
import { searchSource } from './searchSource';

const hit = (over: Partial<SearchHitDto> = {}): SearchHitDto => ({
  id: 'h1',
  ref: 'ENG-12',
  title: 'Sửa lỗi đăng nhập',
  subtitle: 'Team Engineering',
  url: '/issues/h1',
  icon: 'bug',
  score: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('searchSource', () => {
  it('rỗng khi không có nhóm nào', () => {
    expect(searchSource([])).toEqual([]);
  });

  it('rỗng khi có nhóm nhưng nhóm đó không có item', () => {
    const groups: SearchGroupDto[] = [{ type: 'issue', total: 0, items: [] }];
    expect(searchSource(groups)).toEqual([]);
  });

  it('ánh xạ một hit issue thành CommandItem đúng hình dạng — icon, route, id, subtitle', () => {
    const groups: SearchGroupDto[] = [
      { type: 'issue', total: 1, items: [hit()] },
    ];
    expect(searchSource(groups)).toEqual([
      {
        id: 'issue:h1',
        group: 'result',
        title: 'Sửa lỗi đăng nhập',
        subtitle: 'ENG-12 · Team Engineering · Issues',
        icon: 'bug',
        run: { to: '/issues/h1' },
      },
    ]);
  });

  it('mỗi SearchType có nhãn nhóm riêng trong subtitle', () => {
    const types: SearchGroupDto['type'][] = [
      'issue',
      'doc',
      'roadmap-item',
      'project',
      'report',
      'testcase',
    ];
    const expectedLabel: Record<SearchGroupDto['type'], string> = {
      issue: 'Issues',
      doc: 'Docs',
      'roadmap-item': 'Roadmap',
      project: 'Projects',
      report: 'Reports',
      testcase: 'Test cases',
    };
    for (const type of types) {
      const groups: SearchGroupDto[] = [
        { type, total: 1, items: [hit({ id: type, ref: '', subtitle: '' })] },
      ];
      const [item] = searchSource(groups);
      expect(item.subtitle).toBe(expectedLabel[type]);
    }
  });

  it('bỏ qua các đoạn rỗng (ref/subtitle) khi ghép subtitle, không để lại " · " thừa', () => {
    const groups: SearchGroupDto[] = [
      { type: 'doc', total: 1, items: [hit({ ref: '', subtitle: '' })] },
    ];
    expect(searchSource(groups)[0].subtitle).toBe('Docs');
  });

  it('gộp nhiều nhóm thành một mảng phẳng, giữ thứ tự nhóm rồi tới thứ tự item', () => {
    const groups: SearchGroupDto[] = [
      { type: 'issue', total: 2, items: [hit({ id: 'i1' }), hit({ id: 'i2' })] },
      { type: 'doc', total: 1, items: [hit({ id: 'd1', icon: 'docs', url: '/docs/d1' })] },
    ];
    expect(searchSource(groups).map((i) => i.id)).toEqual(['issue:i1', 'issue:i2', 'doc:d1']);
  });

  it('type lạ (server thêm loại mới trước khi FE cập nhật) không làm vỡ dòng — chỉ thiếu nhãn nhóm', () => {
    const groups = [
      { type: 'workflow', total: 1, items: [hit({ id: 'w1' })] },
    ] as unknown as SearchGroupDto[];
    expect(searchSource(groups)).toEqual([
      {
        id: 'workflow:w1',
        group: 'result',
        title: 'Sửa lỗi đăng nhập',
        subtitle: 'ENG-12 · Team Engineering',
        icon: 'bug',
        run: { to: '/issues/h1' },
      },
    ]);
  });
});
