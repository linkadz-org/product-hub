import type { CommandItem } from '../types';

export const RECENT_KEY = 'ph_palette_recent';
export const RECENT_MAX = 10;

/** Mục đã mở gần đây, mới nhất trước. Hỏng dữ liệu thì coi như chưa có gì —
 *  một danh sách gợi ý không đáng để làm vỡ palette. */
export function recentSource(): CommandItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(isCommandItem)
      .slice(0, RECENT_MAX)
      .map((i) => ({ ...i, group: 'recent' as const }));
  } catch {
    return [];
  }
}

export function rememberRecent(item: CommandItem): void {
  const next = [item, ...recentSource().filter((i) => i.id !== item.id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Hết quota / chế độ riêng tư: bỏ qua, đây là tiện ích chứ không phải dữ liệu.
  }
}

/** Một entry cũ hoặc tay sửa có thể thiếu field, sai kiểu, hoặc trỏ tới đích
 *  không còn tồn tại. Ta chỉ kiểm được hình dạng — không kiểm được đích còn
 *  sống hay không — nên giữ điều kiện tối thiểu: đủ field, đúng kiểu chuỗi. */
function isCommandItem(value: unknown): value is CommandItem {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.group === 'string' &&
    typeof v.title === 'string' &&
    typeof v.icon === 'string' &&
    typeof v.run === 'object' &&
    v.run !== null &&
    typeof (v.run as Record<string, unknown>).to === 'string'
  );
}
