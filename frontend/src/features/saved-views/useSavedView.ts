import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { applyFilterParams, applySearchParam } from '@/components/filterParams';
import { t } from '@/i18n';
import type { SavedViewDto } from '@/types/dto';
import { pruneFilters, sanitizeSavedViewQuery, useSavedViews, type AppliedSavedView } from './api';
import { savedViewPath } from './scope';

interface UseSavedViewOptions {
  /**
   * Valid ids per filter category, for dropping selections that point at
   * something deleted since the view was saved. Only list categories that are
   * *cheaply checkable here*: a category left out is passed through untouched,
   * which is the right answer when the truth isn't in hand (a closed enum like
   * severity can't go stale; a team's statuses depend on which board is open).
   */
  valid?: Record<string, Set<string>>;
  /**
   * Fold the board's own fields into the next query string — the kind switch,
   * the view tabs, the sort. Everything a board doesn't share lives here.
   *
   * It writes into a `URLSearchParams` rather than calling setters because
   * react-router builds its next params purely from the object it's handed: two
   * `setSearchParams` calls in one tick both read the same stale snapshot and
   * the second silently discards the first (see `buildKindViewParams` in
   * `IssuesPage`). Applying a view touches five things at once, so it has to be
   * one write.
   */
  write?: (params: URLSearchParams, applied: AppliedSavedView) => void;
}

/**
 * The `?sv=<id>` half of saved views, shared by every board that has them.
 *
 * A saved view is a *label on the URL*, not a replacement for it: applying one
 * writes its filters, search, view and sort into the query string as ordinary
 * params, and `sv` rides alongside naming where they came from. That's what
 * lets a user tweak one chip without the board fighting them back to the saved
 * state, what makes "Modified / Save / Save as new" a plain diff, and what
 * keeps a tweaked view shareable without saving anything.
 *
 * This lived inline in `IssuesPage` while it was the only board with saved
 * views. Extracted rather than copied for the reason the CLAUDE.md board note
 * gives: three boards that each hand-roll the same behaviour is exactly how
 * they drift apart.
 */
export function useSavedView({ valid, write }: UseSavedViewOptions = {}): {
  views: SavedViewDto[] | undefined;
  /** The view `?sv=` names, once loaded and confirmed visible to this user. */
  activeView: SavedViewDto | undefined;
  /** Point `?sv=` at a newly created view — for `SavedViewBar`'s `onSaved`. */
  onSaved: (id: string) => void;
} {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const svId = params.get('sv');
  const { data: views } = useSavedViews();
  const activeView = views?.find((v) => v.id === svId);

  // Read through refs so the apply effect isn't keyed on them. Keying it on
  // these would re-apply the view every time a filter's option list finishes
  // loading — pulling the board back to the saved state seconds after the user
  // started editing it.
  const validRef = useRef(valid);
  const writeRef = useRef(write);
  validRef.current = valid;
  writeRef.current = write;

  /**
   * The view+board this hook has already applied. Opening a view is a one-shot
   * event, but the effect's inputs are not: `views` gets a fresh identity on
   * every background refetch of `GET /saved-views` — including the invalidate
   * that follows saving a view — and re-running would silently reset whatever
   * the user has tweaked since. The board is part of the key because the
   * redirect below lands on a route that may reuse this component (`/issues` →
   * `/issues/me`), where nothing else in the deps changes.
   */
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!svId) {
      // Left the view (or "Clear all" stripped `sv`): the next open of the same
      // view has to apply again, so forget what was applied.
      applied.current = null;
      return;
    }
    if (!views) return; // still loading — wait for the list rather than 404 early.
    if (applied.current === `${pathname}|${svId}`) return;
    if (!activeView) {
      // Deleted, or not shared with this user: open the default board instead
      // of a blank one, and say why.
      toast.error(t('savedViews.cannotOpen'));
      const next = new URLSearchParams(params);
      next.delete('sv');
      setParams(next, { replace: true });
      return;
    }

    // A view saved on another board can reach a board by a hand-edited URL or a
    // bookmark from before scopes existed. Forward to the board it belongs to
    // rather than applying a team's statuses against this one's columns —
    // there, `sv` is picked up again and applied for real.
    const target = savedViewPath(activeView.scope);
    if (target !== pathname) {
      navigate({ pathname: target, search: `?sv=${encodeURIComponent(activeView.id)}` }, { replace: true });
      return;
    }

    // The stored query is never trusted as-is — it may predate a filter-shape
    // change or come from an older client (`CreateSavedViewDto.query` is only
    // `@IsObject()`-validated server-side). `sanitizeSavedViewQuery` defends
    // every field independently so a malformed one degrades to the board's own
    // default rather than crashing or wedging the filter state.
    const q = sanitizeSavedViewQuery(activeView);
    // A deleted project or backlog item must not blank the whole board — drop
    // just that stale id, keep the rest, and say so. A category whose option
    // list hasn't loaded yet is skipped this pass rather than treated as
    // "nothing is valid", so a stale id can survive one apply; that race is
    // deliberate, since re-running once the data lands is exactly the
    // "pulled back after editing" loop the refs above exist to avoid.
    const { filters, dropped } = pruneFilters(q.filters, validRef.current ?? {});

    applied.current = `${pathname}|${svId}`;
    const next = new URLSearchParams(params);
    applyFilterParams(next, filters);
    applySearchParam(next, q.search);
    writeRef.current?.(next, q);
    setParams(next, { replace: true });
    if (dropped) toast.warning(t('savedViews.someFiltersDropped'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svId, views, pathname]);

  const onSaved = useCallback(
    (id: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('sv', id);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { views, activeView, onSaved };
}
