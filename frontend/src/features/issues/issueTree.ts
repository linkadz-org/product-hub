import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { ListResponse } from '@/types/dto';

/** The minimum an issue needs for tree maths — every list DTO already has it. */
export interface TreeIssue {
  id: string;
  parentId: string;
}

/** How far down a subtree is walked. Real nesting is 1–2 deep; the cap stops a
 *  corrupt `parentId` cycle (or someone's 40-level import) from looping forever. */
const MAX_DEPTH = 5;
/** One level's fetch. Not a taste call — `PaginationDto` caps `limit` at 100 and
 *  rejects anything higher, so this is the ceiling. A level that wide is already
 *  unusable as a list anyway. */
const LEVEL_LIMIT = 100;

/**
 * Every descendant of `rootIds` — children, grandchildren, and so on — in one
 * query, walked a level at a time (`GET /issues?parentId=a&parentId=b`).
 *
 * A `parentId` read only ever returns *direct* children, so anything that wanted
 * the whole subtree had to fan out per row. Doing it inside one `queryFn` keeps
 * it to a single cache entry and one loading state, and sidesteps the rules of
 * hooks (depth isn't known up front, so it can't be a hook per level).
 *
 * Two deliberate details about the cache entry, both so this can't drift out of
 * sync with the lists beside it:
 * - it is keyed **under `['issues', …]`**, the same prefix `makeIssueHooks`
 *   invalidates, so any create/update/delete refreshes the nested rows too;
 * - it resolves to `{ items }`, the same shape as a list page, so the optimistic
 *   status swap (`setQueriesData` over that prefix) patches a grandchild's status
 *   as happily as a top-level row's — and doesn't crash on the wrong shape.
 */
export function useIssueDescendants<T extends TreeIssue>(rootIds: string[], enabled = true) {
  // Sorted so the same set in a different order hits the same cache entry.
  const roots = [...new Set(rootIds)].sort();
  return useQuery({
    queryKey: ['issues', 'descendants', roots],
    enabled: enabled && roots.length > 0,
    queryFn: async () => {
      const items: T[] = [];
      // Roots seed it: an issue already in the set is never re-added, which is
      // also what breaks a `parentId` cycle.
      const seen = new Set(roots);
      let frontier = roots;
      for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth++) {
        const page = await apiGet<{ items: T[] }>('/issues', {
          parentId: frontier,
          limit: LEVEL_LIMIT,
        });
        const next = page.items.filter((issue) => !seen.has(issue.id));
        next.forEach((issue) => seen.add(issue.id));
        items.push(...next);
        frontier = next.map((issue) => issue.id);
      }
      return { items };
    },
  });
}

/** An issue placed in the tree — `depth` is what the row indents by. */
export interface IssueTreeNode<T> {
  issue: T;
  depth: number;
}

/**
 * Order a flat set into tree order (parent immediately followed by its subtree),
 * tagging each row with its depth.
 *
 * Anything whose parent isn't in the set is a **root** — that covers both real
 * top-level issues and a child whose parent simply isn't part of this list, so a
 * row can never go missing just because its parent is elsewhere.
 */
export function toIssueTree<T extends TreeIssue>(items: T[]): IssueTreeNode<T>[] {
  const present = new Set(items.map((i) => i.id));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];

  for (const issue of items) {
    if (issue.parentId && present.has(issue.parentId)) {
      const siblings = childrenOf.get(issue.parentId);
      if (siblings) siblings.push(issue);
      else childrenOf.set(issue.parentId, [issue]);
    } else {
      roots.push(issue);
    }
  }

  const out: IssueTreeNode<T>[] = [];
  const walk = (issue: T, depth: number) => {
    out.push({ issue, depth });
    // Depth-capped for the same reason as the fetch: a cycle that survived the
    // data layer must not blow the stack while rendering.
    if (depth >= MAX_DEPTH) return;
    for (const child of childrenOf.get(issue.id) ?? []) walk(child, depth + 1);
  };
  roots.forEach((issue) => walk(issue, 0));
  return out;
}

/**
 * The topmost members of a set — the ones whose parent isn't also in it.
 *
 * What a `parentId`-writing host re-parents. Writing the new parent on *every*
 * picked issue would flatten the subtree the user just chose to keep together:
 * a grandchild would land as a direct child, and the shape they saw in the picker
 * would be gone the moment it linked. Only the roots move; everything below keeps
 * pointing at the parent it already had, so the whole branch travels intact.
 */
export function rootsOf<T extends TreeIssue>(items: T[]): T[] {
  const present = new Set(items.map((i) => i.id));
  return items.filter((i) => !i.parentId || !present.has(i.parentId));
}

/**
 * Every item's direct children, keyed by parent id — the map a recursive tree
 * render walks. Paired with {@link rootsOf} for the top level: `rootsOf(items)`
 * for depth 0, then `groupByParent(items).get(id)` for what hangs under any row
 * from there.
 */
export function groupByParent<T extends TreeIssue>(items: T[]): Map<string, T[]> {
  const present = new Set(items.map((i) => i.id));
  const out = new Map<string, T[]>();
  for (const issue of items) {
    if (!issue.parentId || !present.has(issue.parentId)) continue;
    const siblings = out.get(issue.parentId);
    if (siblings) siblings.push(issue);
    else out.set(issue.parentId, [issue]);
  }
  return out;
}

/**
 * `id` plus everything under it, within `items`. Used to answer both "what comes
 * along if I pick this one" and "what can this one *not* be re-parented under" —
 * they're the same set, because making an issue a child of its own descendant is
 * exactly what creates a cycle.
 */
export function subtreeIds<T extends TreeIssue>(items: T[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const issue of items) {
    if (!issue.parentId) continue;
    const siblings = childrenOf.get(issue.parentId);
    if (siblings) siblings.push(issue.id);
    else childrenOf.set(issue.parentId, [issue.id]);
  }
  const out = new Set([id]);
  const queue = [id];
  while (queue.length) {
    for (const childId of childrenOf.get(queue.pop() as string) ?? []) {
      if (out.has(childId)) continue;
      out.add(childId);
      queue.push(childId);
    }
  }
  return out;
}

/**
 * The parents (and grandparents…) of `items` that aren't in `items` themselves.
 *
 * A filtered list ("Assigned to me", a team, a search…) often holds a child but not
 * its parent, and a child with no parent on screen can only sit at the root — the
 * flat list a hierarchy view exists to replace. So the missing ancestors are fetched
 * and shown as the roots the children hang under. One query: it walks up in batches
 * (one `ids` request per level), so the cost is the tree's depth, not its width.
 * Keyed under `['issues', …]` so it refetches whenever the lists beside it do.
 */
export function useAncestors<T extends { id: string; parentId?: string }>(
  items: T[],
  enabled = true,
): T[] {
  const have = new Set(items.map((i) => i.id));
  const missing = [
    ...new Set(items.map((i) => i.parentId).filter((id): id is string => !!id && !have.has(id))),
  ].sort();
  const active = enabled && missing.length > 0;
  const { data } = useQuery({
    queryKey: ['issues', 'ancestors', missing],
    enabled: active,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const found = new Map<string, T>();
      let wanted = missing;
      // Depth cap: a corrupt parent loop can't keep this walking.
      for (let level = 0; level < 8 && wanted.length; level++) {
        const res = await apiGet<ListResponse<T>>('/issues', { limit: LEVEL_LIMIT, ids: wanted });
        wanted = [];
        for (const issue of res.items) {
          if (found.has(issue.id) || have.has(issue.id)) continue;
          found.set(issue.id, issue);
          const up = issue.parentId;
          if (up && !found.has(up) && !have.has(up)) wanted.push(up);
        }
      }
      // `{ items }`, not a bare array: the optimistic status swap maps `.items` over
      // every cache entry under `['issues']`, and a bare array would crash it.
      return { items: [...found.values()] };
    },
  });
  return active ? (data?.items ?? []) : [];
}

/**
 * Everything a hierarchical list/board needs, in one hook: the listed issues plus
 * their missing ancestors (`all`), the top level (`roots`), each issue's direct
 * children, and which branches are open. Collapsed by default — a view opens as the
 * top-level picture and you drill into the branch you're reading.
 *
 * A parent loop leaves members with no root above them; they're surfaced as roots
 * rather than silently dropped.
 */
export function useIssueTree<T extends TreeIssue>(listed: T[], enabled = true) {
  const ancestors = useAncestors(listed, enabled);
  const all = useMemo(() => {
    if (!ancestors.length) return listed;
    const have = new Set(listed.map((i) => i.id));
    return [...listed, ...ancestors.filter((a) => !have.has(a.id))];
  }, [listed, ancestors]);

  const { roots, childrenOf } = useMemo(() => {
    const childrenOf = groupByParent(all);
    const roots = rootsOf(all);
    const reachable = new Set<string>();
    const reach = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const c of childrenOf.get(id) ?? []) reach(c.id);
    };
    roots.forEach((r) => reach(r.id));
    for (const i of all) {
      if (!reachable.has(i.id)) {
        roots.push(i);
        reach(i.id);
      }
    }
    return { roots, childrenOf };
  }, [all]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return { all, roots, childrenOf, expanded, toggle };
}
