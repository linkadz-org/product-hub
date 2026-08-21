import { describe, expect, it } from 'vitest';
import type { SavedViewDto } from '@/types/dto';
import {
  SCOPE_ISSUES,
  SCOPE_ISSUES_ME,
  groupSavedViews,
  isSavedViewActive,
  savedViewHref,
  savedViewPath,
  teamScope,
} from './scope';

function view(overrides: Partial<SavedViewDto> = {}): SavedViewDto {
  return {
    id: 'sv-1',
    ownerId: 'u-1',
    name: 'My Bugs',
    icon: '',
    color: null,
    scope: SCOPE_ISSUES,
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

describe('savedViewPath', () => {
  it('map các scope đã biết về đúng đường dẫn board', () => {
    expect(savedViewPath(SCOPE_ISSUES)).toBe('/issues');
    expect(savedViewPath(SCOPE_ISSUES_ME)).toBe('/issues/me');
    expect(savedViewPath(teamScope('t-1'))).toBe('/teams/t-1');
  });

  it('rơi về /issues khi scope trống — các view lưu trước khi có scope', () => {
    expect(savedViewPath(undefined)).toBe('/issues');
    expect(savedViewPath('')).toBe('/issues');
  });

  it('rơi về /issues với scope lạ, không trả về nguyên chuỗi đã lưu', () => {
    expect(savedViewPath('board-tuong-lai')).toBe('/issues');
    // `team:` rỗng không trỏ tới team nào — coi như không nhận ra.
    expect(savedViewPath('team:')).toBe('/issues');
  });

  it('không cho giá trị đã lưu tự tạo hình URL — đây là chốt chặn open-redirect', () => {
    // Một view shared do người khác soạn: nếu scope được dùng như path thì
    // `//evil.example` sẽ thành protocol-relative href.
    expect(savedViewPath('//evil.example')).toBe('/issues');
    expect(savedViewPath('https://evil.example')).toBe('/issues');
    // Team id vẫn được encode trên đường ra.
    expect(savedViewPath('team:a/b')).toBe('/teams/a%2Fb');
  });
});

describe('savedViewHref', () => {
  it('ghép pathname của scope với ?sv=<id>', () => {
    expect(savedViewHref(view({ id: 'v9', scope: teamScope('t-2') }))).toEqual({
      pathname: '/teams/t-2',
      search: '?sv=v9',
    });
  });
});

describe('isSavedViewActive', () => {
  it('true khi đứng đúng board và đúng ?sv=<id>', () => {
    expect(isSavedViewActive('/issues', '?sv=sv-1', view())).toBe(true);
  });

  it('false khi ?sv= trỏ tới view khác', () => {
    expect(isSavedViewActive('/issues', '?sv=sv-2', view())).toBe(false);
  });

  it('false khi URL không có tham số sv nào', () => {
    expect(isSavedViewActive('/issues', '', view())).toBe(false);
  });

  it('false khi sv khớp nhưng đang đứng ở board khác — hai view cùng id không thể ở hai nơi', () => {
    expect(isSavedViewActive('/roadmaps', '?sv=sv-1', view())).toBe(false);
    // View của team, nhưng đang đứng ở board workspace.
    expect(isSavedViewActive('/issues', '?sv=sv-1', view({ scope: teamScope('t-1') }))).toBe(false);
  });
});

describe('groupSavedViews', () => {
  it('cắt thành hai list: của tôi và của người khác', () => {
    const mineOne = view({ id: 'a', ownerId: 'me' });
    const theirs = view({ id: 'b', ownerId: 'other', shared: true });
    const { mine, shared } = groupSavedViews([mineOne, theirs], 'me');
    expect(mine.map((v) => v.id)).toEqual(['a']);
    expect(shared.map((v) => v.id)).toEqual(['b']);
  });

  it('view của tôi mà tôi đã share vẫn chỉ nằm ở "của tôi" — liệt kê hai lần sẽ đọc thành hai view', () => {
    const { mine, shared } = groupSavedViews([view({ ownerId: 'me', shared: true })], 'me');
    expect(mine).toHaveLength(1);
    expect(shared).toHaveLength(0);
  });

  it('giữ nguyên thứ tự server trả về trong từng nhóm', () => {
    const list = [
      view({ id: 'a', ownerId: 'me' }),
      view({ id: 'b', ownerId: 'other' }),
      view({ id: 'c', ownerId: 'me' }),
      view({ id: 'd', ownerId: 'other' }),
    ];
    const { mine, shared } = groupSavedViews(list, 'me');
    expect(mine.map((v) => v.id)).toEqual(['a', 'c']);
    expect(shared.map((v) => v.id)).toEqual(['b', 'd']);
  });

  it('danh sách chưa tải xong (undefined) trả về hai list rỗng, không văng', () => {
    expect(groupSavedViews(undefined, 'me')).toEqual({ mine: [], shared: [] });
  });

  it('chưa biết user là ai thì mọi view đều rơi vào "được chia sẻ" — không bao giờ nhận nhầm view của người khác là của mình', () => {
    const { mine, shared } = groupSavedViews([view({ ownerId: 'u-1' })], undefined);
    expect(mine).toHaveLength(0);
    expect(shared).toHaveLength(1);
  });
});
