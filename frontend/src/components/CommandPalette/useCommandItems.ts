import { useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useGlobalSearch } from '@/features/search/api';
import type { SearchGroupDto } from '@/types/dto';
import { navSource } from './sources/navSource';
import { actionSource } from './sources/actionSource';
import { recentSource } from './sources/recentSource';
import { searchSource } from './sources/searchSource';
import type { CommandItem } from './types';

/**
 * Merges the local sources with the remote search results into the flat list
 * the palette renders. Pure and DOM-free on purpose — the ordering/grouping
 * rules it encodes are exactly what a unit test should pin down, and pulling
 * it out of `useCommandItems` lets that test run without React or a hook
 * harness (this repo has neither `@testing-library/react` nor `renderHook`).
 *
 * Nothing typed yet → recents + go-to + create, so the palette is useful the
 * moment it opens. Typed something → search results first, then local
 * commands whose title matches.
 *
 * `groups` defaults the caller passes when `/v1/search` hasn't answered (or
 * never will) — an empty array here, not a thrown error, is how "search is
 * down" stays a non-event for this function.
 */
export function mergeCommandItems(params: {
  q: string;
  local: CommandItem[];
  recent: CommandItem[];
  groups: SearchGroupDto[];
}): CommandItem[] {
  const { q, local, recent, groups } = params;
  const needle = q.trim().toLowerCase();
  if (!needle) return [...recent, ...local];
  const matchedLocal = local.filter((i) => i.title.toLowerCase().includes(needle));
  return [...searchSource(groups), ...matchedLocal];
}

/**
 * Flat list the palette shows.
 *
 * If `/v1/search` dies, `groups` stays `undefined` → `[]`, and the local
 * sources are still there — the palette must NOT depend on search staying
 * alive. See `mergeCommandItems` for the ordering/grouping rules themselves.
 */
export function useCommandItems(q: string): {
  items: CommandItem[];
  loading: boolean;
  /** `/v1/search` is down outright. The palette still works, it just loses the results group. */
  searchFailed: boolean;
} {
  const { isAdmin, canEditDelivery } = useAuth();
  const { data: groups, isFetching, isError } = useGlobalSearch(q);

  const local = useMemo(
    () => [...navSource(isAdmin), ...actionSource(!!canEditDelivery)],
    [isAdmin, canEditDelivery],
  );

  const items = useMemo(
    () => mergeCommandItems({ q, local, recent: recentSource(), groups: groups ?? [] }),
    [q, local, groups],
  );

  return { items, loading: isFetching, searchFailed: isError };
}
