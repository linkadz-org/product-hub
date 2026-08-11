import { beforeEach, describe, expect, it } from 'vitest';
import { RECENT_KEY, RECENT_MAX, recentSource, rememberRecent } from './recentSource';
import type { CommandItem } from '../types';

const item = (id: string): CommandItem => ({
  id, group: 'result', title: id, icon: 'tasks', run: { to: `/x/${id}` },
});

beforeEach(() => localStorage.clear());

describe('recentSource', () => {
  it('rỗng khi chưa mở gì', () => {
    expect(recentSource()).toEqual([]);
  });

  it('mục vừa mở đứng đầu', () => {
    rememberRecent(item('a'));
    rememberRecent(item('b'));
    expect(recentSource()[0].id).toBe('b');
  });

  it('mở lại một mục thì nó lên đầu, không nhân bản', () => {
    rememberRecent(item('a'));
    rememberRecent(item('b'));
    rememberRecent(item('a'));
    expect(recentSource().map((i) => i.id)).toEqual(['a', 'b']);
  });

  it(`giữ tối đa ${RECENT_MAX} mục`, () => {
    for (let i = 0; i < RECENT_MAX + 5; i++) rememberRecent(item(`i${i}`));
    expect(recentSource()).toHaveLength(RECENT_MAX);
  });

  it('không vỡ khi localStorage chứa rác (không phải JSON)', () => {
    localStorage.setItem(RECENT_KEY, 'not json');
    expect(recentSource()).toEqual([]);
  });

  it('không vỡ khi key hoàn toàn vắng mặt', () => {
    expect(localStorage.getItem(RECENT_KEY)).toBeNull();
    expect(recentSource()).toEqual([]);
  });

  it('không vỡ khi JSON hợp lệ nhưng sai hình dạng (object thay vì mảng)', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify({ foo: 'bar' }));
    expect(recentSource()).toEqual([]);
  });

  it('không vỡ khi JSON là mảng nguyên thuỷ, không phải mảng object', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify([1, 2, 3]));
    expect(recentSource()).toEqual([]);
  });

  it('lọc bỏ entry thiếu field bắt buộc, giữ lại entry hợp lệ', () => {
    const good = item('good');
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: 'bad', title: 'no icon/run' }, good]));
    expect(recentSource().map((i) => i.id)).toEqual(['good']);
  });

  it('lọc bỏ entry có run.to sai kiểu', () => {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify([{ id: 'bad', group: 'result', title: 'x', icon: 'tasks', run: { to: 123 } }]),
    );
    expect(recentSource()).toEqual([]);
  });
});
