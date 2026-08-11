import type { IconName } from '@/components/Icon';
import type { SavedViewDto } from '@/types/dto';
import type { CommandItem } from '../types';

/**
 * A workspace's saved views, as "jump to this board filter" commands.
 *
 * `views` is whatever `useSavedViews()` returned — own views and shared ones
 * alike, already scoped server-side. No ownership filtering happens here on
 * purpose: the sidebar doesn't filter by owner either, and the palette must
 * not disagree with it about what's visible.
 *
 * `undefined`/`[]` both map to `[]` — the caller passes `views ?? []` for the
 * pending/error case, same as the other sources degrade to nothing rather
 * than breaking the palette.
 */
export function savedViewSource(views: SavedViewDto[]): CommandItem[] {
  return views.map((v) => ({
    id: `view:${v.id}`,
    group: 'views' as const,
    title: v.name,
    icon: (v.icon || 'checks') as IconName,
    run: { to: `/issues?sv=${v.id}` },
  }));
}
