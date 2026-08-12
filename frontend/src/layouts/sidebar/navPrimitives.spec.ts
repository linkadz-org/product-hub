import { describe, expect, it } from 'vitest';
import { canDeleteSavedView, isSavedViewActive, savedViewIcon } from './navPrimitives';
import type { SavedViewDto } from '@/types/dto';

function view(overrides: Partial<SavedViewDto> = {}): SavedViewDto {
  return {
    id: 'sv-1',
    ownerId: 'u-1',
    name: 'My Bugs',
    icon: '',
    color: null,
    scope: 'workspace',
    shared: false,
    kind: 'bug',
    view: 'board',
    filters: {},
    sort: null,
    search: '',
    order: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('savedViewIcon', () => {
  it('rơi về "checks" khi view chưa có icon riêng (icon rỗng)', () => {
    expect(savedViewIcon(view({ icon: '' }))).toBe('checks');
  });

  it('dùng icon riêng của view khi có', () => {
    expect(savedViewIcon(view({ icon: 'bug' }))).toBe('bug');
  });
});

describe('isSavedViewActive', () => {
  it('true khi đang ở /issues với đúng ?sv=<id>', () => {
    expect(isSavedViewActive('/issues', '?sv=sv-1', 'sv-1')).toBe(true);
  });

  it('false khi ?sv= trỏ tới view khác', () => {
    expect(isSavedViewActive('/issues', '?sv=sv-2', 'sv-1')).toBe(false);
  });

  it('false khi không có tham số sv nào trên URL', () => {
    expect(isSavedViewActive('/issues', '', 'sv-1')).toBe(false);
  });

  it('false khi không đứng ở /issues, kể cả khi sv khớp', () => {
    expect(isSavedViewActive('/roadmaps', '?sv=sv-1', 'sv-1')).toBe(false);
  });
});

describe('canDeleteSavedView', () => {
  it('true khi actor là chủ sở hữu view', () => {
    expect(canDeleteSavedView(view({ ownerId: 'u-1' }), { id: 'u-1', isAdmin: false })).toBe(true);
  });

  it('true khi actor là admin, kể cả không phải chủ sở hữu (view shared)', () => {
    expect(canDeleteSavedView(view({ ownerId: 'u-1' }), { id: 'u-2', isAdmin: true })).toBe(true);
  });

  it('false khi actor không phải chủ sở hữu và cũng không phải admin — mới là ca của một view shared bị xem bởi đồng nghiệp khác', () => {
    expect(canDeleteSavedView(view({ ownerId: 'u-1' }), { id: 'u-2', isAdmin: false })).toBe(false);
  });

  it('false khi chưa đăng nhập (id undefined) và không phải admin', () => {
    expect(canDeleteSavedView(view({ ownerId: 'u-1' }), { id: undefined, isAdmin: false })).toBe(false);
  });
});
