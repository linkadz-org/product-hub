import { useNavigate } from 'react-router-dom';
import { useEscapeBack } from '@/lib/useEscapeBack';
import { PageHeader } from '@/layouts/headers/PageHeader';
import { useIssueCrumbParent } from '@/features/issues/useIssueCrumb';
import { IssueKind } from '@/types/enums';
import { useTask } from './api';
import { TaskDetail } from './components/TaskDetail';
import { CenteredPageLayout } from '@/layouts/shared';

/** One task's detail: the breadcrumb chrome around the shared, embeddable
 * <TaskDetail> (which also renders inside a sub-task peek drawer). Mirrors
 * BugDetailPage → BugDetail. Reached at `/issues/<ref>` — `IssueDetailPage`
 * resolves the kind and hands the ref down, so this isn't a route on its own. */
export function TaskDetailPage({ issueRef: taskId }: { issueRef: string }) {
  const navigate = useNavigate();
  useEscapeBack();

  // Fetched only for the crumb (title + team); <TaskDetail> re-reads the same
  // query (React Query dedupes it) for the body.
  const { data: task } = useTask(taskId);

  // Breadcrumb parent: the task's own team board, then its backlog item and
  // parent when it has them — shared with a bug's page, so both kinds read
  // `All issues › <team> › <ref>`.
  const parent = useIssueCrumbParent(IssueKind.TASK, task);
  // A private personal task belongs to no team; the crumb above already points
  // at the Personal board, and deleting one returns there too.
  const isPersonal = !!task?.ownerId;

  return (
    <CenteredPageLayout>
      {/* Titles, not refs — see BugDetailPage. The ref rides along as hover text
          and is already printed above the body's own heading. */}
      <PageHeader
        title={task?.title || task?.shortId || taskId || ''}
        subtitle={task?.shortId}
        parent={parent}
      />

      <TaskDetail
        taskId={taskId}
        menuTarget="topbar"
        onDeleted={() => navigate(isPersonal ? '/issues/personal' : '/issues/me')}
      />
    </CenteredPageLayout>
  );
}
