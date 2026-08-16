import { describe, expect, it } from 'vitest';
import type { SavedViewDto } from '@/types/dto';
import { savedViewSource } from './savedViewSource';

const view = (over: Partial<SavedViewDto> = {}): SavedViewDto => ({
  id: 'v1',
  ownerId: 'u1',
  name: 'My triage',
  icon: 'inbox',
  color: null,
  scope: 'team',
  shared: false,
  kind: 'bug',
  view: 'board',
  filters: {},
  sort: null,
  search: '',
  order: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

describe('savedViewSource', () => {
  it('rỗng khi không có view nào', () => {
    expect(savedViewSource([])).toEqual([]);
  });

  it('ánh xạ một view thành CommandItem đúng hình dạng — id, nhóm, icon, route tới /issues?sv=', () => {
    expect(savedViewSource([view()])).toEqual([
      {
        id: 'view:v1',
        group: 'views',
        title: 'My triage',
        icon: 'inbox',
        run: { to: '/issues?sv=v1' },
      },
    ]);
  });

  it('view không có icon dùng "checks" làm mặc định', () => {
    const [item] = savedViewSource([view({ icon: '' })]);
    expect(item.icon).toBe('checks');
  });

  it('view chia sẻ (shared: true, không phải của người dùng hiện tại) vẫn xuất hiện — không lọc theo owner', () => {
    const shared = view({ id: 'v2', ownerId: 'someone-else', name: 'Team backlog', shared: true });
    expect(savedViewSource([shared])).toEqual([
      {
        id: 'view:v2',
        group: 'views',
        title: 'Team backlog',
        icon: 'inbox',
        run: { to: '/issues?sv=v2' },
      },
    ]);
  });

  it('giữ nguyên thứ tự đầu vào — không tự sắp xếp lại (server đã sắp theo order)', () => {
    const views = [view({ id: 'v3', order: 2 }), view({ id: 'v1', order: 0 }), view({ id: 'v2', order: 1 })];
    expect(savedViewSource(views).map((i) => i.id)).toEqual(['view:v3', 'view:v1', 'view:v2']);
  });
});
