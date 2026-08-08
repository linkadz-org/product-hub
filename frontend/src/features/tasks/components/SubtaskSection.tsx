import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Link2, Link2Off, Plus } from 'lucide-react';
import { Button, ProgressBar, Select, Spinner } from '@/components/ui';
import { AssigneeField, fallbackNames } from '@/components/AssigneeField';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth';
import { useTeams, useTeamStatusesLookup } from '@/features/teams/api';
import { TeamIconPicker } from '@/features/teams/TeamIconPicker';
import { IssuePeekDrawer, type IssuePeek } from '@/features/issues/IssuePeekDrawer';
import { groupByParent, rootsOf, subtreeIds, useIssueDescendants } from '@/features/issues/issueTree';
import { IssueKind, TeamIssueType, isIssueDone, taskStatusColor } from '@/types/enums';
import type { IssueDto } from '@/types/dto';
import {
  useCreateIssue,
  useIssues,
  useSetIssueStatus,
  useUpdateIssue,
  type CreateIssueInput,
  type IssueQuery,
  type UpdateIssueInput,
} from '@/features/issues/api';
import { TaskComposerCard, type TeamOption } from './TaskComposerCard';

export interface SubtaskSectionProps {
  /** How to fetch the children — `{ roadmapItemId }` (a backlog item's linked
   *  issues) or `{ parentId }` (an issue's sub-issues). Reads the unified
   *  `/issues` collection, so either query can come back with **tasks and bugs**:
   *  a bug nests under a parent exactly like a task does. */
  query: IssueQuery;
  /** Fields merged into every created child — the link (and, for a backlog item,
   *  the project scope + denormalized label). */
  createLink: Partial<CreateIssueInput>;
  /**
   * The inverse of {@link createLink}: what to write to a **top-level** row to
   * take it out of this list — the backlog link cleared, or `parentId` emptied.
   *
   * Required, not optional, and deliberately so. This button used to call
   * `useDeleteIssue`, so "take it off this backlog item" destroyed the issue
   * outright — every field, no confirm, no undo. A row is listed here because of
   * a *link*, so removing it may only undo that link; the issue itself is not
   * this panel's to destroy (the all-issues board still deletes). Leaving the
   * prop optional is how a future host would silently get no button at all.
   */
  unlink: Partial<UpdateIssueInput>;
  /** Tooltip for that button on a top-level row — say which list it leaves, since
   *  "remove" alone is what read as "delete". Nested rows label themselves. */
  unlinkLabel: string;
  /** Teams offered in the composer; more than one grows a picker that also drives
   *  the status columns. **The picked team decides the kind** — offer a bug team
   *  and the child is created as a bug (a backlog item can take "fix this bug"
   *  as work); offer only task teams and nothing changes. */
  composerTeams: TeamOption[];
  /** The team a new child lands in by default (the only team, or the workspace
   *  default task team — so a new child is a task unless you pick otherwise). */
  defaultTeamId: string;
  titlePlaceholder?: string;
  /** Children can span teams (a backlog item's do) — shows a per-row team badge. */
  crossTeam?: boolean;
  /**
   * The issue this list hangs off, when the list *is* "children of X" — it becomes
   * the top entry of every row's Parent picker, i.e. "directly under this one".
   * Omit on a backlog item's list, where rows are held by `roadmapItemId` and the
   * top entry is "No parent" instead.
   */
  rootParent?: { id: string; title: string };
  /**
   * Put bugs in their own list below the sub-tasks and **out of the progress
   * rollup**. On a backlog item a linked bug is work *found*, not work *planned*:
   * counting it made the delivery number fall the moment someone filed a bug,
   * which is backwards. Off by default — on a bug's own detail page every child is
   * a bug, and separating them would leave the sub-task list permanently empty.
   */
  separateBugs?: boolean;
  /** When set, a "link existing" icon sits beside `+`; clicking it opens the
   *  host's picker (only the backlog board can link across teams today). */
  onLinkExisting?: () => void;
  /** Outer wrapper — the top border + spacing, so each host can tune the gap. */
  className?: string;
}

/**
 * The one Sub-tasks section, shared by a backlog item (roadmap) and a team task.
 * Modelled on the backlog item's panel — the richer of the two: a header with the
 * "N of M done" rollup, a `+` add and an optional link-existing icon, a progress
 * bar, then rows whose title opens that child's own detail (a task or a bug, by
 * its team). Adding one merges `createLink` so the child is filed and linked in
 * one write; completed children drive the rollup.
 *
 * Both kinds are first-class here: which team you pick in the composer decides
 * whether the child is a task or a bug, matching what the section already
 * *shows* (a linked bug has always rendered beside the tasks).
 *
 * **A row's ✕ unlinks; it does not delete.** Everything here is listed by virtue
 * of a link — `roadmapItemId` on a backlog item's panel, `parentId` under a task
 * — so the only thing this panel may take away is that link. It used to call
 * `useDeleteIssue`, which meant the row's own destroy-button sat inches from its
 * Parent dropdown and wiped the issue for good on one click.
 *
 * **The list is a tree, not a flat set.** The query only ever returns one level
 * (direct children, or the issues on a backlog item), so deeper work simply
 * didn't appear and the rollup quietly ignored it. Descendants are fetched and
 * drawn indented under their parent, every row shown counts toward the rollup,
 * and each row's Parent picker lets you restructure in place — its options leave
 * out the row's own subtree, since re-parenting under your own descendant is
 * exactly what makes a cycle.
 */
export function SubtaskSection({
  query,
  createLink,
  unlink,
  unlinkLabel,
  composerTeams,
  defaultTeamId,
  titlePlaceholder = t('subtasks.titlePlaceholder'),
  crossTeam = false,
  rootParent,
  separateBugs = false,
  onLinkExisting,
  className,
}: SubtaskSectionProps) {
  const { user, canManageDelivery: isAdmin, canEditDelivery: canWrite } = useAuth();

  // Spans both kinds: a backlog item lists its linked tasks *and* bugs.
  const { data, isLoading } = useIssues(query);
  const items = useMemo(() => data?.items ?? [], [data]);
  // …and everything below them, so a grandchild isn't invisible work.
  const { data: deeper } = useIssueDescendants<IssueDto>(items.map((it) => it.id));

  const all = useMemo(() => {
    const byId = new Map<string, IssueDto>();
    for (const issue of [...items, ...(deeper?.items ?? [])]) byId.set(issue.id, issue);
    return [...byId.values()];
  }, [items, deeper]);

  // Bugs move out of the planned-work list (and its rollup) only where the host
  // says so — see `separateBugs`.
  const planned = separateBugs ? all.filter((it) => it.kind !== IssueKind.BUG) : all;
  const bugs = separateBugs ? all.filter((it) => it.kind === IssueKind.BUG) : [];
  // Root rows plus a parent→children lookup, so rendering can recurse instead of
  // walking a pre-flattened list — see `renderNode`.
  const plannedRoots = rootsOf(planned);
  const plannedChildren = groupByParent(planned);
  const bugRoots = rootsOf(bugs);
  const bugChildren = groupByParent(bugs);

  // Collapsed by default — a deep tree used to dump every descendant on the
  // page at once. Presence means *expanded* (not the more common "collapsed
  // set") specifically so the empty initial state reads as "nothing open yet"
  // regardless of when descendants finish loading.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Columns are per-team, and these children can span teams — resolve per row.
  const statusesFor = useTeamStatusesLookup();
  // Each row is labelled with its own team when children can span teams.
  const { data: teams } = useTeams();
  const teamById = new Map((teams ?? []).map((tm) => [tm.id, tm]));

  const create = useCreateIssue();
  const update = useUpdateIssue();
  const setStatus = useSetIssueStatus();

  const [adding, setAdding] = useState(false);
  // The child previewed in the right-side drawer (click a row to peek).
  const [peek, setPeek] = useState<IssuePeek | null>(null);

  // Rollup spans both kinds, so "done" is read per issue — a bug is finished at
  // resolved/closed, a task at done. Whatever is shown above the bar is what it
  // counts; a visible row that didn't count is the confusion this avoids.
  const done = planned.filter((tk) => isIssueDone(tk.kind, tk.status)).length;
  const total = planned.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  /** Where this row may be re-parented: the list's own root (or "no parent"),
   *  plus every other row **outside its own subtree** — a row can't move under
   *  something it already contains. */
  function parentOptions(id: string) {
    const own = subtreeIds(all, id);
    const top = rootParent
      ? { value: rootParent.id, label: rootParent.title }
      : { value: '', label: t('subtasks.parentNone') };
    return [top, ...all.filter((it) => !own.has(it.id)).map((it) => ({ value: it.id, label: it.title }))];
  }

  function renderRow(tk: IssueDto, depth: number, hasChildren: boolean) {
    // "Mine" is *am I on it*, not *am I the only one* — a child can be shared.
    const mine = !!user && tk.assignees.some((a) => a.id === user.id);
    const assigneeIds = tk.assignees.map((a) => a.id);
    const assigneeLabel = tk.assignees.map((a) => a.name).join(', ');
    const team = teamById.get(tk.teamId);
    // This child's own columns — a bug team's `open`/`resolved` are as real here
    // as a task's `todo`, so the dot reads its colour from the resolved column,
    // not the task palette.
    const columns = statusesFor(tk.teamId, team?.issueType ?? TeamIssueType.TASK);
    const column = columns.find((c) => c.key === tk.status);

    const options = canWrite ? parentOptions(tk.id) : [];
    // Its parent may be an issue this panel doesn't list (a backlog item's rows
    // can hang off anything). Say so rather than drawing it as top-level.
    const parentKnown = options.some((o) => o.value === tk.parentId);
    if (canWrite && !parentKnown && tk.parentId) {
      options.push({ value: tk.parentId, label: t('subtasks.parentElsewhere') });
    }

    return (
      <div
        className={cn(
          'flex flex-col gap-2 rounded-md border border-border bg-background px-2 py-1.5',
          // Narrow screens stack the title over its controls; from `sm` the
          // controls flatten into fixed columns so they line up across rows.
          'sm:grid sm:items-center sm:gap-2',
          canWrite
            ? 'sm:grid-cols-[minmax(0,1fr)_128px_112px_140px_28px]'
            : 'sm:grid-cols-[minmax(0,1fr)_112px_140px]',
        )}
      >
        {/* Title (+ status dot) — peeks the child in a right-side drawer. */}
        <div className="flex min-w-0 items-center gap-2">
          {/* Collapse toggle — `invisible` (not unmounted) on a childless row so
              every row's title still lines up under the same left edge. */}
          <button
            type="button"
            onClick={() => hasChildren && toggleExpanded(tk.id)}
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground',
              hasChildren ? 'hover:bg-muted hover:text-foreground' : 'invisible',
            )}
            aria-label={expandedIds.has(tk.id) ? t('subtasks.collapse') : t('subtasks.expand')}
            title={expandedIds.has(tk.id) ? t('subtasks.collapse') : t('subtasks.expand')}
            aria-expanded={hasChildren ? expandedIds.has(tk.id) : undefined}
            tabIndex={hasChildren ? 0 : -1}
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform', expandedIds.has(tk.id) && 'rotate-90')}
            />
          </button>
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: column?.color ?? taskStatusColor(tk.status) }}
            aria-hidden
          />
          <button
            type="button"
            onClick={() =>
              setPeek({
                id: tk.id,
                issueType: team?.issueType ?? TeamIssueType.TASK,
                // A child can be a bug or a task; one URL serves both.
                href: `/issues/${tk.shortId || tk.id}`,
              })
            }
            className={cn(
              'min-w-0 flex-1 truncate text-left text-sm underline-offset-4 hover:underline',
              isIssueDone(tk.kind, tk.status) && 'text-muted-foreground line-through',
            )}
            title={tk.title}
          >
            {tk.title}
          </button>
          {/* Which team owns this child — only when they can span teams. */}
          {crossTeam && team && (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              title={`${t('tasks.team')}: ${team.name}`}
            >
              <TeamIconPicker team={team} readOnly size={12} className="shrink-0" />
              <span className="max-w-[90px] truncate">{team.name}</span>
            </span>
          )}
        </div>

        {/* `sm:contents` drops this box at `sm+` so its children become grid
            cells directly — one markup for both layouts. */}
        <div className="flex flex-wrap items-center gap-2 sm:contents">
          {/* Parent — restructure without opening the child. */}
          {canWrite && (
            <Select
              value={tk.parentId}
              onValueChange={(v) =>
                update.mutate(
                  { id: tk.id, input: { parentId: v } },
                  // A dropdown that silently snaps back just reads as broken.
                  { onError: (err) => toast.error(t('common.error'), { description: err.message }) },
                )
              }
              options={options}
              className="h-7 w-full min-w-[128px] flex-1 sm:w-full sm:min-w-0 sm:flex-none"
              aria-label={t('subtasks.parent')}
            />
          )}

          {/* Status */}
          {canWrite ? (
            <Select
              value={tk.status}
              onValueChange={(v) => setStatus.mutate({ id: tk.id, status: v })}
              options={columns.map((c) => ({ value: c.key, label: c.label }))}
              className="h-7 w-full min-w-[112px] flex-1 sm:w-full sm:min-w-0 sm:flex-none"
              aria-label={t('roadmaps.status')}
            />
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              {column?.label ?? tk.status}
            </span>
          )}

          {/* Assignee */}
          <div className="flex min-w-0 flex-1 items-center sm:flex-none">
            {isAdmin ? (
              <AssigneeField
                multiple
                value={assigneeIds}
                onChange={(ids) => update.mutate({ id: tk.id, input: { assigneeIds: ids } })}
                placeholder={t('tasks.assign')}
                className="h-7 w-full"
                fallbackNames={fallbackNames(tk.assignees)}
                aria-label={t('tasks.assignee')}
              />
            ) : canWrite && tk.assignees.length > 0 && !mine ? (
              <span className="truncate text-xs text-muted-foreground" title={assigneeLabel}>
                {assigneeLabel}
              </span>
            ) : canWrite ? (
              <Button
                type="button"
                variant={mine ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7"
                // Adds/removes *me*, leaving anyone else on it alone.
                onClick={() =>
                  update.mutate({
                    id: tk.id,
                    input: {
                      assigneeIds: mine
                        ? assigneeIds.filter((id) => id !== user?.id)
                        : [...assigneeIds, user?.id ?? ''].filter(Boolean),
                    },
                  })
                }
              >
                {mine ? t('tasks.assignedYou') : t('tasks.assignMe')}
              </Button>
            ) : (
              <span className="truncate text-xs text-muted-foreground">
                {assigneeLabel || t('tasks.unassigned')}
              </span>
            )}
          </div>

          {/* Unlink — takes the row out of this list, keeps the issue. A nested row
              is here because of its parent, so that's the link it sheds; a
              top-level one sheds whatever put it in the list (`unlink`). */}
          {canWrite && (
            <button
              type="button"
              onClick={() =>
                update.mutate(
                  { id: tk.id, input: depth > 0 ? { parentId: '' } : unlink },
                  // A row that stays put after you click it just reads as broken.
                  { onError: (err) => toast.error(t('common.error'), { description: err.message }) },
                )
              }
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:justify-self-end"
              aria-label={depth > 0 ? t('subtasks.unlinkParent') : unlinkLabel}
              title={depth > 0 ? t('subtasks.unlinkParent') : unlinkLabel}
            >
              <Link2Off className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  /**
   * A row plus, when it has children and is expanded, the nested block that
   * holds them. Each child draws its own elbow — a short stub down from its
   * parent's trunk, then a 90° turn into the row — instead of a continuous
   * side line, so the branch a row belongs to reads at a glance rather than
   * just "indented a bit more." `isLast` (this child's position among its own
   * siblings, decided by the caller) is what tells its trunk stub to stop at
   * its own elbow instead of running on past it toward a sibling that isn't
   * there — the classic `├─`/`└─` shape, minus the ASCII art.
   *
   * The connector is `border`-coloured at rest and brightens on hover of
   * *either* the row or anything nested under it — plain (unnamed)
   * `group`/`group-hover`, which in nested branches matches every hovered
   * ancestor at once, so hovering a grandchild lights the path all the way to
   * its root parent. A sibling branch never lights up by mistake: each elbow
   * lives inside the `.group` of the row it points to, not a shared ancestor.
   */
  function renderNode(
    tk: IssueDto,
    depth: number,
    childrenOf: Map<string, IssueDto[]>,
    isLast: boolean,
  ) {
    const children = childrenOf.get(tk.id) ?? [];
    const hasChildren = children.length > 0;
    return (
      <div key={tk.id} className="group flex items-start">
        {depth > 0 && (
          <div className="relative w-5 shrink-0 self-stretch">
            {/* Stub down from the parent's trunk to this row's elbow — full
                height (bleeding into the next sibling's gap) unless this is
                the last child, where the trunk has nowhere further to go. */}
            <span
              className={cn(
                'absolute left-2.5 top-0 w-px bg-border transition-colors group-hover:bg-primary/50',
                isLast ? 'h-4' : '-bottom-1.5',
              )}
            />
            {/* The 90° turn into the row. */}
            <span className="absolute left-2.5 top-4 h-px w-2.5 bg-border transition-colors group-hover:bg-primary/50" />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {renderRow(tk, depth, hasChildren)}
          {hasChildren && expandedIds.has(tk.id) && (
            <div className="flex flex-col gap-1.5">
              {children.map((child, i) =>
                renderNode(child, depth + 1, childrenOf, i === children.length - 1),
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className={cn('mt-8 border-t border-border pt-4', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('subtasks.title')}
        </span>
        <div className="flex items-center gap-1.5">
          {total > 0 && (
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">
              {t('tasks.doneOf').replace('{done}', String(done)).replace('{total}', String(total))}
            </span>
          )}
          {canWrite && onLinkExisting && (
            <button
              type="button"
              onClick={onLinkExisting}
              className="grid size-6 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('tasks.pick')}
              title={t('tasks.pick')}
            >
              <Link2 className="size-3.5" />
            </button>
          )}
          {canWrite && !adding && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="grid size-6 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('subtasks.add')}
              title={t('subtasks.add')}
            >
              <Plus className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="mb-3">
          <ProgressBar value={pct} />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        {isLoading ? (
          <div className="flex justify-center py-3">
            <Spinner />
          </div>
        ) : planned.length === 0 && !adding ? (
          <p className="py-2 text-sm text-muted-foreground">{t('subtasks.empty')}</p>
        ) : (
          plannedRoots.map((tk, i) => renderNode(tk, 0, plannedChildren, i === plannedRoots.length - 1))
        )}
      </div>

      {canWrite && adding && (
        <TaskComposerCard
          teams={composerTeams}
          defaultTeamId={defaultTeamId}
          pending={create.isPending}
          titlePlaceholder={titlePlaceholder}
          onCancel={() => setAdding(false)}
          onCreate={(input, finish) =>
            create.mutate(
              // `createLink` owns the link fields; `kind` stays the composer's —
              // it follows the team picked there, so a bug team files a bug.
              { ...input, ...createLink, kind: input.kind },
              // Keep the card open with its property picks so you can batch several.
              { onSuccess: () => finish() },
            )
          }
        />
      )}

      {/* Bugs found against this work — listed, but deliberately outside the bar
          above. Hidden entirely when there are none, so the panel doesn't carry a
          permanently empty heading. */}
      {separateBugs && bugs.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('subtasks.bugs')}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">{bugs.length}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {bugRoots.map((tk, i) => renderNode(tk, 0, bugChildren, i === bugRoots.length - 1))}
          </div>
        </div>
      )}

      {/* Click a row → preview that child (task or bug) in a right-side drawer. */}
      <IssuePeekDrawer peek={peek} onClose={() => setPeek(null)} />
    </section>
  );
}
