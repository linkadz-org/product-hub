import type { IconName } from '@/components/Icon';

export type CommandGroup = 'recent' | 'views' | 'goto' | 'create' | 'result';

/** Điều một dòng làm khi bấm Enter. Chỉ có điều hướng — palette v1 không có
 *  lệnh tác động lên dữ liệu (xem mục 11 của spec). */
export interface NavigateRun {
  to: string;
}

export interface CommandItem {
  /** Duy nhất trong toàn danh sách — dùng làm React key và khoá "gần đây". */
  id: string;
  group: CommandGroup;
  title: string;
  subtitle?: string;
  icon: IconName;
  run: NavigateRun;
}
