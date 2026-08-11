import type { IconName } from '@/components/Icon';
import type { SearchGroupDto } from '@/types/dto';
import { t } from '@/i18n';
import type { CommandItem } from '../types';

const GROUP_LABEL: Record<SearchGroupDto['type'], string> = {
  issue: 'palette.groupIssues',
  doc: 'palette.groupDocs',
  'roadmap-item': 'palette.groupRoadmap',
  project: 'palette.groupProjects',
  report: 'palette.groupReports',
  testcase: 'palette.groupTestCases',
};

/**
 * Backend đã trả sẵn `url` và `icon` cho từng dòng, nên chỗ này không phải biết
 * đường dẫn hay icon của bất kỳ loại nào — chỉ ghép chúng thành `CommandItem`.
 *
 * Một `type` lạ (server thêm loại mới trước khi FE kịp cập nhật `GROUP_LABEL`)
 * không làm vỡ dòng: `GROUP_LABEL[g.type]` trả `undefined`, `t()` không được
 * gọi tới (xem dưới), và `.filter(Boolean)` lặng lẽ bỏ đoạn nhãn nhóm khỏi
 * subtitle thay vì literal "undefined".
 */
export function searchSource(groups: SearchGroupDto[]): CommandItem[] {
  return groups.flatMap((g) =>
    g.items.map((hit) => ({
      id: `${g.type}:${hit.id}`,
      group: 'result' as const,
      title: hit.title,
      subtitle: [hit.ref, hit.subtitle, groupLabel(g.type)].filter(Boolean).join(' · '),
      icon: hit.icon as IconName,
      run: { to: hit.url },
    })),
  );
}

function groupLabel(type: SearchGroupDto['type']): string {
  const key = GROUP_LABEL[type];
  // `as never` here silences the exact guarantee CLAUDE.md relies on — that a
  // key missing from en.ts/ko.ts is a compile error. It's load-bearing only
  // because the six `palette.group*` keys don't exist yet: Task 18 adds them.
  // Until then `t()` falls back to rendering the literal key string (see
  // `frontend/src/i18n/index.ts`) rather than failing typecheck. Delete this
  // cast — and pass `key` straight to `t()` — once Task 18 lands those keys.
  return key ? t(key as never) : '';
}
