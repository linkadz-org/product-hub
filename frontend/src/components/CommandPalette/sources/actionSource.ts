import { t } from '@/i18n';
import type { CommandItem } from '../types';

/** Lệnh tạo mới. Ẩn hoàn toàn với người không có quyền ghi — hiện ra rồi báo
 *  lỗi khi bấm là tệ hơn không hiện. */
export function actionSource(canWrite: boolean): CommandItem[] {
  if (!canWrite) return [];
  return [
    { id: 'create:task', group: 'create', title: t('palette.createTask'), icon: 'tasks', run: { to: '/tasks/new' } },
    { id: 'create:bug', group: 'create', title: t('palette.createBug'), icon: 'bug', run: { to: '/bugs/new' } },
  ];
}
