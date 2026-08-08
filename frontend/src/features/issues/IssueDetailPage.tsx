import { useParams } from 'react-router-dom';
import { DetailSkeleton } from '@/components/Skeletons';
import { CenteredPageLayout } from '@/layouts/shared';
import { IssueKind, TeamIssueType } from '@/types/enums';
import type { TeamDto } from '@/types/dto';
import { useTeams } from '@/features/teams/api';
import { BugDetailPage } from '@/features/bugs/BugDetailPage';
import { TaskDetailPage } from '@/features/tasks/TaskDetailPage';
import { useIssue } from './api';

/**
 * The kind a ref names, without asking the API — so the right page renders
 * immediately, with no lookup and no skeleton flash.
 *
 * Two prefixes say it outright: the workspace-wide `BUG-`/`TSK-` sequences, which
 * every legacy ticket and every team-less personal task still carries.
 *
 * A team-prefixed ref (`ENG-14`) says it just as clearly, one hop further: a team
 * owns exactly one issue type, so its prefix is its kind. `useTeams` is the same
 * cached `['teams']` query the nav, the boards and every status lookup already
 * read (see `useTeamStatusesLookup`) — it is loaded before this page mounts, so
 * resolving through it costs no request and no render.
 *
 * `undefined` only for a bare-UUID link (a row from before refs, or someone
 * pasting an internal id) or a prefix belonging to no team we can see — those ask
 * the API, which is what the skeleton is for.
 */
function kindFromRef(ref: string, teams: TeamDto[] | undefined): IssueKind | undefined {
  const [prefix] = ref.toUpperCase().split('-');
  if (!prefix || prefix === ref.toUpperCase()) return undefined;
  if (prefix === 'BUG') return IssueKind.BUG;
  if (prefix === 'TSK') return IssueKind.TASK;
  const team = teams?.find((t) => t.refPrefix?.toUpperCase() === prefix);
  if (!team) return undefined;
  return team.issueType === TeamIssueType.BUG ? IssueKind.BUG : IssueKind.TASK;
}

/**
 * One detail URL for both kinds: `/issues/TSK-Y8HH6RY`, `/issues/BUG-3`. A ref
 * identifies an issue on its own, so the URL never had to carry the kind — and
 * making it carry one meant every link site had to branch on `issue.kind` first,
 * with a bug chip pointing at `/tasks/…` the standing bug. This resolves the kind
 * once, here, and renders that kind's page. (`/tasks/:ref` and `/bugs/:ref` still
 * redirect here, so older links and bookmarks keep working.)
 */
export function IssueDetailPage() {
  const { issueRef = '' } = useParams<{ issueRef: string }>();
  // Already in cache for the nav — this is a read, not a fetch (see `kindFromRef`).
  const { data: teams, isLoading: teamsLoading } = useTeams();
  const known = kindFromRef(issueRef, teams);
  // Skipped entirely when the ref already told us (`enabled: !!id`), and held
  // until teams have answered — firing it against a prefix they are about to
  // resolve would spend a request to learn what is already on its way.
  const { data: issue, isLoading } = useIssue(known || teamsLoading ? undefined : issueRef);
  const kind = known ?? issue?.kind;

  // Waiting on teams counts as loading: on a cold load (a pasted `ENG-14` link)
  // the prefix is unresolvable for one tick, and falling through would mount the
  // task page for a bug and then swap it out.
  if (!kind && (isLoading || teamsLoading)) {
    return (
      <CenteredPageLayout>
        <DetailSkeleton />
      </CenteredPageLayout>
    );
  }

  // A ref that resolves to nothing falls through to the task page, whose own
  // "not found" state is the right answer for a dead link of either kind.
  return kind === IssueKind.BUG ? (
    <BugDetailPage issueRef={issueRef} />
  ) : (
    <TaskDetailPage issueRef={issueRef} />
  );
}
