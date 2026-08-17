import { describe, expect, it } from 'vitest';
import { IssueKind } from '@/types/enums';
import { buildKindViewParams } from './IssuesPage';

describe('buildKindViewParams', () => {
  it('đặt cả kind và view trong MỘT URLSearchParams — không rơi vào race hai lần setSearchParams', () => {
    // Trước sửa: một saved view mở từ board Task với kind='bug' bị setKind()
    // rồi setView() ghi đè lên nhau (cả hai đọc cùng một `params` cũ), nên URL
    // cuối cùng chỉ phản ánh lệnh gọi sau — kind quay lại 'task' dù view đã
    // lưu là board bug. Hàm thuần này phải đặt cả hai trong một params.
    const current = new URLSearchParams('');
    const next = buildKindViewParams(current, IssueKind.BUG, 'list');
    expect(next.get('kind')).toBe('bug');
    expect(next.get('view')).toBe('list');
  });

  it('mở saved view Bug từ board Task hiện tại (kind=task trong URL) phải chuyển kind sang bug', () => {
    const current = new URLSearchParams('kind=task');
    const next = buildKindViewParams(current, IssueKind.BUG, 'board');
    expect(next.get('kind')).toBe('bug');
    // Board là view mặc định, không xuất hiện trong URL.
    expect(next.has('view')).toBe(false);
  });

  it('kind=task không xuất hiện trong URL (task là mặc định)', () => {
    const current = new URLSearchParams('kind=bug&view=list');
    const next = buildKindViewParams(current, IssueKind.TASK, 'timeline');
    expect(next.has('kind')).toBe(false);
    expect(next.get('view')).toBe('timeline');
  });

  it('giữ nguyên các param khác đã có trên URL (vd. sv)', () => {
    const current = new URLSearchParams('sv=abc123');
    const next = buildKindViewParams(current, IssueKind.BUG, 'list');
    expect(next.get('sv')).toBe('abc123');
    expect(next.get('kind')).toBe('bug');
    expect(next.get('view')).toBe('list');
  });

  it('không đổi gì khi kind/view đích đã trùng với URL hiện tại', () => {
    const current = new URLSearchParams('kind=bug&view=list');
    const next = buildKindViewParams(current, IssueKind.BUG, 'list');
    expect(next.get('kind')).toBe('bug');
    expect(next.get('view')).toBe('list');
  });
});
