import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { SearchGroupDto } from '@/types/dto';

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => [...searchKeys.all, q] as const,
};

export const MIN_QUERY_LENGTH = 2;

/** Backend's `SearchQueryDto` 400s under 2 characters — mirrored here so a
 *  short query never leaves the browser. Split out (rather than inlined into
 *  `enabled` below) so it's unit-testable without spinning up React Query. */
export function shouldSearch(q: string): boolean {
  return q.trim().length >= MIN_QUERY_LENGTH;
}

/**
 * Global search (⌘K result group). The caller debounces keystrokes — this hook
 * only decides *whether* a query is worth sending, not *when*.
 *
 * `enabled` keeps a sub-2-character query from ever reaching the server.
 * `placeholderData: (prev) => prev` keeps the last query's rows on screen
 * while the next one loads, so the palette doesn't blank out on every
 * keystroke. `staleTime` means retyping the same string within 30s reuses the
 * cache instead of re-hitting the network. Requests are keyed by `q`
 * (`searchKeys.query`), so React Query itself discards a stale in-flight
 * response if the query has since changed — no manual request sequencing.
 */
export function useGlobalSearch(q: string) {
  return useQuery({
    queryKey: searchKeys.query(q),
    queryFn: () => apiGet<{ groups: SearchGroupDto[] }>('/search', { q }),
    enabled: shouldSearch(q),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}
