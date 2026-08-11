import { NAV_AREAS, type NavItem } from '@/layouts/sidebar/menuConfig';
import { t } from '@/i18n';
import type { CommandItem } from '../types';

/**
 * Mọi trang trong sidebar, dưới dạng lệnh "Đi tới".
 *
 * Đọc thẳng NAV_AREAS thay vì chép danh sách: thêm một trang vào sidebar là ⌘K
 * biết ngay, không phải nhớ cập nhật hai chỗ.
 *
 * Lọc `adminOnly` ở CẢ hai cấp (area và item) — bỏ sót là guest gõ ⌘K sẽ thấy
 * mục Settings.
 *
 * Nhận `isAdmin` chứ không nhận `role`: Sidebar cũng lọc bằng đúng biến đó
 * (`Sidebar.tsx:85,104,217,295` — `const { isAdmin } = useAuth()`). Tự suy ra
 * admin từ `role` ở đây là mở đường cho palette và sidebar bất đồng ý kiến.
 */
export function navSource(isAdmin: boolean): CommandItem[] {
  const out: CommandItem[] = [];

  for (const area of NAV_AREAS) {
    if (area.adminOnly && !isAdmin) continue;
    for (const section of area.sections) {
      for (const item of section.items.flatMap((i) => [i, ...(i.children ?? [])])) {
        if (item.adminOnly && !isAdmin) continue;
        // Hàng cha chỉ là toggle, không phải đích đến.
        if (item.children?.length) continue;
        // Hàng mang query (`kind=bug`) trùng pathname với hàng khác — một dòng
        // trong palette là đủ.
        if (item.search) continue;
        out.push(toCommand(item));
      }
    }
  }
  return out;
}

function toCommand(item: NavItem): CommandItem {
  return {
    id: `goto:${item.path}`,
    group: 'goto',
    title: t(item.labelKey),
    icon: item.icon,
    run: { to: item.path },
  };
}
