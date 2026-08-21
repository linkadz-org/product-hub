import type { IconName } from '@/components/Icon';
import { savedViewPath } from '@/features/saved-views/scope';
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
 *
 * The destination is resolved from the view's own scope rather than assumed to
 * be `/issues`: a view saved on a team board has to reopen *there*, and
 * `savedViewPath` is the single place any `sv` URL is built (see `scope.ts` —
 * a stored path would be an open redirect on a workspace-shared view).
 */
export function savedViewSource(views: SavedViewDto[]): CommandItem[] {
  return views.map((v) => ({
    id: `view:${v.id}`,
    group: 'views' as const,
    title: v.name,
    icon: (v.icon || 'checks') as IconName,
    run: { to: `${savedViewPath(v.scope)}?sv=${encodeURIComponent(v.id)}` },
  }));
}
