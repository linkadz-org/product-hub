import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FilterSelections } from './FilterMenu';

/**
 * The board's *narrowing* state — what the Filter menu and the search box hold —
 * carried in the URL instead of component state.
 *
 * Why the URL and not `useState`: a board is a place, and a filtered board is a
 * different place. Held in state, every filter died the moment the page
 * unmounted — open an issue from a filtered board, press Back, and you landed on
 * the unfiltered board with no way to get your list back. It also couldn't be
 * reloaded, bookmarked or pasted to a teammate. `view`, `sort`, `cycle` and
 * `kind` already ride here for exactly these reasons; `filters` and `search`
 * were the two that got left behind.
 *
 * This is also what makes a *saved view* work as a label rather than a cage:
 * `?sv=<id>` names the view a board was opened from, but the raw params beside
 * it are the truth. Tweak one chip and the URL still describes the board
 * exactly — which is both how "Modified / Save / Save as new" can tell there's
 * a change, and how an ad-hoc filter can be shared without saving anything.
 */

/**
 * Namespace for every filter param. Without it a filter category collides with
 * a param that means something else on the same board: `BugsBoardPage` reads
 * `?projectId=` as the *scope* of the whole board (bugs for one project, with
 * its own back link and title) **and** offers `projectId` as a filter category.
 * Sharing one param name would make the filter silently re-scope the page.
 */
export const FILTER_PARAM_PREFIX = 'f.';

/** The search box's param. Named `q` because that's what a URL calls it. */
export const SEARCH_PARAM = 'q';

/** How long typing must pause before the search term is written to the URL. */
const SEARCH_DEBOUNCE_MS = 350;

/** A category id → its param name. */
export function filterParamName(categoryId: string): string {
  return `${FILTER_PARAM_PREFIX}${categoryId}`;
}

/**
 * The filter params out of a URL.
 *
 * Values are **repeated params** (`?f.status=todo&f.status=doing`) rather than
 * one comma-joined value. A status key is team-authored and a date range is
 * stored as `start..end` — neither is guaranteed comma-free, and a separator
 * that can appear inside a value is a bug waiting for the one customer who
 * names a column "Blocked, waiting". `URLSearchParams.getAll` does the
 * splitting natively, so there's no escaping to get wrong.
 *
 * Nothing is validated against a category list here on purpose. A URL outlives
 * the code that wrote it, and the categories a board offers depend on data that
 * hasn't loaded yet (a team's statuses, the workspace's projects) — so an
 * unknown key is passed through rather than dropped. An id that no longer
 * matches anything simply returns no rows, exactly as it does when a saved view
 * carries one; `pruneFilters` is where stale ids get cleaned, with the data in
 * hand to know they're stale.
 */
export function readFilterParams(params: URLSearchParams): FilterSelections {
  const out: FilterSelections = {};
  for (const key of new Set(params.keys())) {
    if (!key.startsWith(FILTER_PARAM_PREFIX)) continue;
    const categoryId = key.slice(FILTER_PARAM_PREFIX.length);
    if (!categoryId) continue;
    // A bare `?f.status=` is someone hand-editing the URL, not a selection.
    const values = params.getAll(key).filter((v) => v !== '');
    if (values.length) out[categoryId] = values;
  }
  return out;
}

/**
 * Write filters into a `URLSearchParams` **in place**, for a caller already
 * building the next query string (applying a saved view sets the filters, the
 * search, the kind, the view and the sort — and react-router builds its next
 * params purely from the object it's handed, so those have to be one write or
 * the last one silently wins; see `buildKindViewParams` in `IssuesPage`).
 *
 * Every existing filter param is cleared first, so this *replaces* the filter
 * state rather than merging into it — an unticked option has to actually leave
 * the URL. Non-filter params are untouched.
 */
export function applyFilterParams(params: URLSearchParams, filters: FilterSelections): void {
  for (const key of new Set(params.keys())) {
    if (key.startsWith(FILTER_PARAM_PREFIX)) params.delete(key);
  }
  for (const [categoryId, values] of Object.entries(filters)) {
    for (const value of values ?? []) params.append(filterParamName(categoryId), value);
  }
}

/** Write the search term in place. An empty term removes the param — the
 *  resting state is a clean URL, like `view=board` and "no sort". */
export function applySearchParam(params: URLSearchParams, search: string): void {
  if (search) params.set(SEARCH_PARAM, search);
  else params.delete(SEARCH_PARAM);
}

/** Which view tab the board is on. */
export type BoardView = 'board' | 'list' | 'timeline';

/** The view switch's param. Board is the default and stays *out* of the URL. */
export const VIEW_PARAM = 'view';

/** Read the picked view. Anything unrecognised — a stale link, a hand-edited
 *  URL — reads as the board, the same degrade-to-default rule the sort and the
 *  filters follow. */
export function readBoardView(params: URLSearchParams): BoardView {
  const value = params.get(VIEW_PARAM);
  return value === 'list' || value === 'timeline' ? value : 'board';
}

/** Write the view in place, for a caller building the next query string (a
 *  saved view sets this alongside the filters, the search and the sort). */
export function applyBoardView(params: URLSearchParams, view: BoardView): void {
  if (view === 'board') params.delete(VIEW_PARAM);
  else params.set(VIEW_PARAM, view);
}

/**
 * The view switch's `value`/`onChange` pair, held in the URL.
 *
 * Every board already did this by hand, with the same three-way ternary copied
 * three times. Shared here because a saved view now has to write the view too,
 * and the board that reads it and the hook that writes it must agree on the
 * param — the CLAUDE.md board rule, applied to URL state rather than chrome.
 */
export function useBoardView(): [BoardView, (next: BoardView) => void] {
  const [params, setParams] = useSearchParams();
  const view = readBoardView(params);
  const setView = useCallback(
    (next: BoardView) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          applyBoardView(p, next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [view, setView];
}

/**
 * The Filter menu's `value`/`onChange` pair, held in the URL.
 *
 * `replace: true` for the same reason `useIssueSort` uses it: ticking a filter
 * refines the board you're on, it isn't a place you should have to press Back
 * through five times to escape. Back still restores the filters — the board's
 * history entry now carries them, which is the whole point.
 */
export function useFilterParams(): [FilterSelections, (next: FilterSelections) => void] {
  const [params, setParams] = useSearchParams();
  const filters = readFilterParams(params);
  const setFilters = useCallback(
    (next: FilterSelections) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          applyFilterParams(p, next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [filters, setFilters];
}

/**
 * The search box's `value`/`onChange` pair, held in the URL — but only after
 * typing pauses.
 *
 * The input stays on local state so it never lags a keystroke, and the URL is
 * written once the user stops. That debounce isn't a nicety: a `replaceState`
 * per character is throttled by the browser (Safari drops calls past ~100 in
 * 30s and logs a security error), so a fast typist could lose the very state
 * this hook exists to keep.
 *
 * The URL is still the source of truth. When it changes for a reason other than
 * this hook's own write — Back, or a saved view being applied — the input
 * adopts it; `pushed` is what tells the two apart, so an in-flight keystroke is
 * never yanked out from under the user by the value they just replaced.
 */
export function useSearchParam(): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const urlTerm = params.get(SEARCH_PARAM) ?? '';
  const [term, setTerm] = useState(urlTerm);
  /** The last term this hook and the URL agreed on. */
  const pushed = useRef(urlTerm);

  useEffect(() => {
    if (urlTerm === pushed.current) return;
    pushed.current = urlTerm;
    setTerm(urlTerm);
  }, [urlTerm]);

  useEffect(() => {
    if (term === pushed.current) return;
    const id = setTimeout(() => {
      pushed.current = term;
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          applySearchParam(p, term);
          return p;
        },
        { replace: true },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [term, setParams]);

  return [term, setTerm];
}
