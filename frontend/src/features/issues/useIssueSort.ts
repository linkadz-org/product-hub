import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { IssueSortDir, IssueSortField } from './api';

/** The picked ordering — exactly the API's `sort` + `dir` pair. */
export interface IssueSort {
  field: IssueSortField;
  dir: IssueSortDir;
}

/**
 * What a list starts on: **nothing**. Sorting is an ability the user reaches for,
 * not a default the page applies for them.
 *
 * This is load-bearing, not a preference. A page is capped at 100 rows with no
 * pagination, and the API's ID sort leads on `refPrefix` — so a default ID sort on
 * a workspace with teams ENG/QC/WEB and 500 issues returns 100 *WEB* issues and
 * nothing else. Sending neither param is what keeps the first screen a slice of
 * the whole workspace, exactly as it was before ID sorting existed.
 */
export const NO_ISSUE_SORT: IssueSort | null = null;

/** The URL params the ordering rides in — named after the API's own, so a shared
 *  link, the request it produces and the menu all say the same word. */
export const SORT_PARAM = 'sort';
export const DIR_PARAM = 'dir';

/** Every `sort` value the API accepts. Anything else in the URL is not a sort. */
const VALID_FIELDS: IssueSortField[] = ['id', 'created', 'updated', 'severity'];

/**
 * Read the ordering out of a URL. Anything unrecognised reads as **no sort** —
 * a query string is user-editable and outlives the code that wrote it, so a
 * stale `?sort=priority` has to degrade to the board's own order, never throw or
 * reach the API as an invalid value.
 *
 * `severity` is gated: it only means something on a list that holds bugs, so a
 * caller that doesn't offer the field in its menu doesn't get it from the URL
 * either — otherwise a link would silently apply an ordering the control can't
 * show, let alone undo.
 */
export function readIssueSort(
  params: URLSearchParams,
  opts: { severity?: boolean } = {},
): IssueSort | null {
  const field = params.get(SORT_PARAM) as IssueSortField | null;
  if (!field || !VALID_FIELDS.includes(field)) return NO_ISSUE_SORT;
  if (field === 'severity' && !opts.severity) return NO_ISSUE_SORT;
  // The API defaults to `desc` and so does the menu's first pick; only an
  // explicit `asc` flips it.
  return { field, dir: params.get(DIR_PARAM) === 'asc' ? 'asc' : 'desc' };
}

/**
 * Write an ordering into a `URLSearchParams` **in place**, for a caller already
 * building the next query string (see `IssuesPage`'s Kind switch). No sort
 * removes both params rather than writing a "none" — the resting state is a clean
 * URL, the same way the default board view is the absence of `?view=`.
 */
export function applyIssueSort(params: URLSearchParams, next: IssueSort | null): void {
  if (!next) {
    params.delete(SORT_PARAM);
    params.delete(DIR_PARAM);
    return;
  }
  params.set(SORT_PARAM, next.field);
  params.set(DIR_PARAM, next.dir);
}

/**
 * The list's ordering, held in the URL instead of component state — so a reload,
 * a Back, or a link pasted to a teammate all land on the list you were actually
 * looking at. Same contract as `view` and `cycle` on these boards, including the
 * `replace: true`: picking a sort is a change to the current view, not a place in
 * history you should have to press Back through.
 *
 * Returns the pair `SortMenu` takes, so a page reads exactly as it did when this
 * was `useState`.
 */
export function useIssueSort(
  opts: { severity?: boolean } = {},
): [IssueSort | null, (next: IssueSort | null) => void] {
  const [params, setParams] = useSearchParams();
  const sort = readIssueSort(params, opts);
  const setSort = useCallback(
    (next: IssueSort | null) => {
      const p = new URLSearchParams(params);
      applyIssueSort(p, next);
      setParams(p, { replace: true });
    },
    [params, setParams],
  );
  return [sort, setSort];
}
