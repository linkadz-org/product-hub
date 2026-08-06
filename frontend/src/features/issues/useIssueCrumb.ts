import { t } from '@/i18n';
import { useTeams } from '@/features/teams/api';
import { useBacklogLink } from '@/features/roadmaps/useBacklogLink';
import { IssueKind } from '@/types/enums';
import type { PageCrumb } from '@/layouts/headers/PageHeader';

/** The fields the trail is built from — a subset of `IssueDto` served by the
 *  single-issue read. A list read leaves the resolved ones (`parentShortId`)
 *  empty, which is exactly the "omit it" case. */
interface CrumbIssue {
  teamId?: string;
  ownerId?: string;
  parentShortId?: string;
  parentTitle?: string;
  roadmapId?: string;
  roadmapItemId?: string;
  roadmapItemLabel?: string;
}

/** A crumb's tooltip: the ref its label no longer shows, plus the full title the
 *  label may have truncated. Either half can be missing. */
const hoverText = (shortId?: string, title?: string) =>
  [shortId, title].filter(Boolean).join(' · ') || undefined;

/**
 * The trail an issue's page hangs under: **its own team's board**, then the
 * **backlog item** it delivers, then its **parent issue** — so a task and a bug
 * read the same way, `All issues › Engineering › RM-7VBD8CR › TSK-…`.
 * (The root crumb isn't ours: `/issues/<ref>` sits under All issues in the nav
 * model, which `Topbar` resolves via `findNavItem`.)
 *
 * Both kinds' detail pages call this instead of naming a parent themselves — a
 * bug's crumb used to say the literal word "Bugs" while a task's said its team,
 * so the same URL shape told you two different things depending on what you'd
 * clicked. One hook, one shape.
 *
 * Ordered widest-first, and both middle crumbs are optional, so the trail is as
 * long as the issue's context actually is:
 * - **Backlog item** — the roadmap item this work delivers. Not hierarchy (an
 *   item lives in `roadmaps.items`, not the `issues` collection), but it *is*
 *   what this issue sits under, and the trail is where people look for that.
 *   Resolved through `useBacklogLink` because an issue stores only the composite
 *   `"<phase> · <title>"` label, and a crumb wants the bare title; that label is
 *   the fallback until (or unless) the roadmaps load.
 * - **Parent issue** — what made nesting visible at all: it's stored as a bare
 *   `parentId`, so a sub-issue's page looked exactly like a top-level one. It
 *   appears only when the API resolved it (`parentShortId`), which the
 *   single-issue read does and a list read doesn't; a dangling or unreadable
 *   parent comes back empty and is simply omitted, never a dead link.
 *
 * **Crumbs are named, not referenced.** `RM-7VBD8CR › TSK-MNWG4V2` is a trail
 * only to someone who already knows both — the point of a breadcrumb is to say
 * *where you are* without opening anything. So every crumb shows its title and
 * carries `ref · title` as hover text; refs stay where they're actually used, on
 * the page itself and in search. A title falls back to the ref rather than
 * rendering an empty crumb.
 *
 * Neither position is held open when empty. A crumb is a place you can go, and
 * a placeholder standing in for "nothing yet" is a control — that belongs in
 * Properties (`ParentPropField`, `BacklogItemPropField`), which is where both
 * are set.
 *
 * Falls back to the kind's own list while `teams` is still loading, or when the
 * team can't be resolved at all (deleted since), so the crumb is never a dead
 * end. A private personal task belongs to no team and points at the Personal
 * board instead — it must never claim a team it isn't in.
 */
export function useIssueCrumbParent(kind: IssueKind, issue: CrumbIssue | undefined): PageCrumb[] {
  const { data: teams } = useTeams();
  const team = teams?.find((tm) => tm.id === issue?.teamId);
  // Costs a `GET /roadmaps` only for an issue that actually has an item to name
  // — and on a detail page `BacklogItemPropField` has already fetched it.
  const { itemFor } = useBacklogLink(!!issue?.roadmapItemId);

  const board: PageCrumb = issue?.ownerId
    ? { to: '/issues/personal', label: t('personal.title') }
    : team
      ? { to: `/teams/${team.id}`, label: team.name }
      : kind === IssueKind.BUG
        ? { to: '/issues?kind=bug', label: t('bugs.title') }
        : { to: '/issues/me', label: t('tasks.assignedToMe') };

  const crumbs: PageCrumb[] = [board];

  // Needs `roadmapId` too — the item's page is nested under its roadmap, and a
  // link with only half the pair would 404.
  if (issue?.roadmapId && issue.roadmapItemId) {
    const item = itemFor(issue.roadmapItemId);
    crumbs.push({
      to: `/roadmaps/${issue.roadmapId}/items/${issue.roadmapItemId}`,
      // `roadmapItemLabel` still carries its `"<phase> · "` prefix — it's the
      // stand-in until the roadmaps land, not the preferred label.
      label: item?.title || issue.roadmapItemLabel || t('tasks.backlogItem'),
      title: hoverText(item?.shortId, item?.title || issue.roadmapItemLabel),
    });
  }

  if (issue?.parentShortId) {
    crumbs.push({
      to: `/issues/${issue.parentShortId}`,
      label: issue.parentTitle || issue.parentShortId,
      title: hoverText(issue.parentShortId, issue.parentTitle),
    });
  }

  return crumbs;
}
