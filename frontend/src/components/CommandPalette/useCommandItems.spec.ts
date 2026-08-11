import { describe, expect, it } from 'vitest';
import type { SearchGroupDto } from '@/types/dto';
import type { CommandItem } from './types';
import { mergeCommandItems } from './useCommandItems';

const item = (over: Partial<CommandItem> = {}): CommandItem => ({
  id: 'goto:/issues',
  group: 'goto',
  title: 'Issues',
  icon: 'bug',
  run: { to: '/issues' },
  ...over,
});

describe('mergeCommandItems', () => {
  it('chưa gõ gì: gần đây trước, rồi các lệnh local (đi tới/tạo mới) — bỏ qua kết quả search dù có', () => {
    const recent = [item({ id: 'recent:1', group: 'recent' })];
    const local = [item({ id: 'goto:/tasks', title: 'Tasks' })];
    const groups: SearchGroupDto[] = [
      { type: 'issue', total: 1, items: [{ id: 'x', ref: '', title: 'X', subtitle: '', url: '/x', icon: 'bug', score: 1, updatedAt: '' }] },
    ];
    expect(mergeCommandItems({ q: '', local, recent, groups }).map((i) => i.id)).toEqual([
      'recent:1',
      'goto:/tasks',
    ]);
  });

  it('chuỗi trắng (chỉ khoảng trắng) coi như chưa gõ gì', () => {
    const recent = [item({ id: 'recent:1', group: 'recent' })];
    const local = [item()];
    expect(mergeCommandItems({ q: '   ', local, recent, groups: [] }).map((i) => i.id)).toEqual([
      'recent:1',
      'goto:/issues',
    ]);
  });

  it('đã gõ: kết quả search trước, rồi lệnh local có tên khớp — bỏ qua gần đây', () => {
    const recent = [item({ id: 'recent:1', group: 'recent' })];
    const local = [
      item({ id: 'goto:/issues', title: 'Issues' }),
      item({ id: 'goto:/docs', title: 'Docs' }),
    ];
    const groups: SearchGroupDto[] = [
      {
        type: 'issue',
        total: 1,
        items: [{ id: 'h1', ref: 'ENG-1', title: 'Issue hit', subtitle: '', url: '/issues/h1', icon: 'bug', score: 1, updatedAt: '' }],
      },
    ];
    const result = mergeCommandItems({ q: 'iss', local, recent, groups });
    expect(result.map((i) => i.id)).toEqual(['issue:h1', 'goto:/issues']);
  });

  it('khớp không phân biệt hoa/thường và khớp một phần trong tên', () => {
    const local = [item({ id: 'goto:/issues', title: 'Issues' }), item({ id: 'goto:/docs', title: 'Docs' })];
    const result = mergeCommandItems({ q: 'ISS', local, recent: [], groups: [] });
    expect(result.map((i) => i.id)).toEqual(['goto:/issues']);
  });

  it('đã gõ nhưng không khớp gì và search rỗng: trả về mảng rỗng', () => {
    const local = [item({ id: 'goto:/issues', title: 'Issues' })];
    expect(mergeCommandItems({ q: 'zzz', local, recent: [], groups: [] })).toEqual([]);
  });

  it('search chết (groups rỗng vì lỗi) không làm vỡ hàm — các lệnh local khớp vẫn còn', () => {
    const local = [item({ id: 'goto:/issues', title: 'Issues' })];
    const result = mergeCommandItems({ q: 'iss', local, recent: [], groups: [] });
    expect(result).toEqual([item({ id: 'goto:/issues', title: 'Issues' })]);
  });
});
