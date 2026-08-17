import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarRange, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui';
import { AssigneeBadge } from '@/components/AssigneeBadge';
import { BoardSkeleton, ListSkeleton, TimelineSkeleton } from '@/components/Skeletons';
import { BOARD_GUTTER, IssueBoardLayout } from '@/components/IssueBoardLayout';
import { KanbanBoard, KanbanCardToolbar } from '@/components/KanbanBoard';
import { Icon } from '@/components/Icon';
import { IssueTimelineView } from '@/features/issues/IssueTimelineView';
import { SortMenu } from '@/features/issues/SortMenu';
import { applyIssueSort, useIssueSort } from '@/features/issues/useIssueSort';
import { LabelChips } from '@/features/labels/LabelChips';
import { FilterMenu, type FilterCategory, type FilterSelections } from '@/components/FilterMenu';
import { issueSharedFilterParams, issueSharedFilters } from '@/features/issues/issueFilters';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useProjects } from '@/features/projects/api';
import { useRoadmaps } from '@/features/roadmaps/api';
import { useUsers } from '@/features/users/api';
import { useTeamStatuses, useTeamStatusesLookup, useTeamLabelsLookup } from '@/features/teams/api';
import {
  BUG_SEVERITIES,
  BUG_SEVERITY_COLOR,
  BUG_SEVERITY_LABEL,
  IssueKind,
  TeamIssueType,
  type BugSeverity,
  type TaskLabelConfig,
  type TeamStatusConfig,
} from '@/types/enums';
import type { BugDto, CycleDto, IssueDto, TaskDto } from '@/types/dto';
import { IssueCycleChip } from '@/features/cycles/CycleControls';
import { useCycleLookup } from '@/features/cycles/api';
import { TaskCard } from '@/features/tasks/MyTasksPage';
import { BugCard } from '@/features/bugs/BugsBoardPage';
import { pruneFilters, sanitizeSavedViewQuery, useSavedViews } from '@/features/saved-views/api';
import { SavedViewBar } from '@/features/saved-views/SavedViewBar';
import { useDeleteIssue, useIssues, useSetIssueStatus } from './api';

/**
 * Builds the URL params for setting `kind` and `view` together in one
 * `setSearchParams` call.
 *
 * `setKind`/`setView` (below) each wrap `setSearchParams` by building a fresh
 * `URLSearchParams` from whatever `params` snapshot is in their closure, then
 * calling `setParams`. React-router's `setSearchParams` builds its next
 * params purely from that argument — it does not merge with any other call
 * made in the same tick. So calling `setKind(...)` then `setView(...)`
 * back-to-back (as the saved-view apply effect used to) races: both read the
 * *same* stale `params` snapshot, and the second call's `replace()` silently
 * discards whatever the first one just wrote — the URL ends up reflecting
 * only the second call. Concretely, applying a saved Bug-board view opened
 * from the Task board would revert to `kind=task` because `setView` ran last
 * and rebuilt the URL without the `kind` change `setKind` had just made.
 *
 * Exported and pure (no state, no `setParams` call) so this can be unit
 * tested without mounting the page.
 */
export function buildKindViewParams(
  current: URLSearchParams,
  kind: IssueKind,
  view: 'board' | 'list' | 'timeline',
): URLSearchParams {
  const next = new URLSearchParams(current);
  if (kind === IssueKind.BUG) next.set('kind', 'bug');
  else next.delete('kind');
  if (view === 'board') next.delete('view');
  else next.set('view', view);
  return next;
}

/** The two kinds the board can show, in switch order. */
const KIND_TABS = [
  { kind: IssueKind.TASK, icon: 'tasks', labelKey: 'issues.kindTasks' },
  { kind: IssueKind.BUG, icon: 'bug', labelKey: 'issues.kindBugs' },
] as const;

/** A segmented Task | Bug control — the one axis a card can't share (task and bug
 * statuses genuinely differ), so it lives in the toolbar and switches the whole
 * board's columns + cards. Active tab uses the brand fill; there's no toggle-group
 * primitive in the UI kit, so it's two buttons. */
function KindSwitch({ value, onChange }: { value: IssueKind; onChange: (k: IssueKind) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
      {KIND_TABS.map(({ kind, icon, labelKey }) => {
        const active = value === kind;
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(kind)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon name={icon} size={15} />
            <span>{t(labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Columns for a board that spans teams. The default team's set is the baseline;
 * any status a fetched issue actually carries that's missing from it is appended,
 * labelled and coloured from that issue's *own* team (a team can rename its
 * columns or add its own). Without this, `KanbanBoard` groups by column and would
 * silently drop those rows — a board called "All issues" would be lying. The
 * fallback is a neutral token, never an invented colour.
 */
function extendColumns(
  base: TeamStatusConfig[],
  items: IssueDto[],
  statusesOf: (teamId: string | undefined) => TeamStatusConfig[],
): TeamStatusConfig[] {
  const out = [...base];
  for (const it of items) {
    if (!it.status || out.some((c) => c.key === it.status)) continue;
    out.push(
      statusesOf(it.teamId).find((c) => c.key === it.status) ?? {
        key: it.status,
        label: it.status,
        color: 'hsl(var(--muted-foreground))',
      },
    );
  }
  return out;
}

/** Which slice of the workspace the board shows. Same board, one filter apart. */
export type IssueScope = 'all' | 'mine';

/**
 * The unified issue board — tasks and bugs in one place (assigned bugs used to be
 * invisible in the task-only "Assigned to me"). A Kind switch flips between the
 * two: one kind at a time, so each keeps its own status columns and card. Board /
 * list / timeline like every other board.
 *
 * Two routes, one component:
 * - `/issues` (`scope="all"`) — every issue in the workspace, filterable by assignee.
 * - `/issues/me` (`scope="mine"`) — only what's assigned to me.
 */
export function IssuesPage({ scope }: { scope: IssueScope }) {
  const { user, canEditDelivery: canWrite, canManageDelivery } = useAuth();
  const isAll = scope === 'all';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const kind = params.get('kind') === 'bug' ? IssueKind.BUG : IssueKind.TASK;
  const isBug = kind === IssueKind.BUG;

  const [filters, setFilters] = useState<FilterSelections>({});
  const [search, setSearch] = useState('');
  // List-view ordering only (see `SortMenu`), and opt-in: until the user picks
  // one, neither param is sent and the list is exactly the page the API returns
  // by default. The board keeps its drag order the same way. Held in ?sort=&dir=
  // beside ?kind= and ?view=, so a reload or a shared link keeps it — and the
  // severity gate follows the Kind switch, so a bug link's `?sort=severity`
  // simply doesn't apply if the same URL is later flipped to tasks.
  const [sort, setSort] = useIssueSort({ severity: isBug });

  // Switching kind rides in the URL (shareable) and clears the filters — severity
  // is bug-only, backlog item is task-only, and the status columns differ, so
  // nothing carries across cleanly.
  const setKind = (next: IssueKind) => {
    if (next === kind) return;
    const p = new URLSearchParams(params);
    if (next === IssueKind.BUG) p.set('kind', 'bug');
    else p.delete('kind');
    // Severity is bug-only for the *sort* too, so it leaves with the kind rather
    // than lingering in the URL as a param the task list would ignore. Written
    // into the same `p` as the kind — one navigation, so neither can clobber the
    // other. Every other field means the same on both kinds and is left alone.
    if (next !== IssueKind.BUG && sort?.field === 'severity') applyIssueSort(p, null);
    setParams(p, { replace: true });
    setFilters({});
  };

  // Board is default and kept out of the URL; ?view=list | ?view=timeline are shareable.
  const viewParam = params.get('view');
  const view: 'board' | 'list' | 'timeline' =
    viewParam === 'list' ? 'list' : viewParam === 'timeline' ? 'timeline' : 'board';
  const setView = (v: 'board' | 'list' | 'timeline') => {
    const next = new URLSearchParams(params);
    if (v === 'board') next.delete('view');
    else next.set('view', v);
    setParams(next, { replace: true });
  };
  const isList = view === 'list';

  const issueType = isBug ? TeamIssueType.BUG : TeamIssueType.TASK;
  // Columns start as the *default* team's statuses for this kind — this board spans
  // teams (all of them, or my work everywhere), so it isn't scoped to one team's
  // list. `extendColumns` below adds any status the default team doesn't have.
  const defaultColumns = useTeamStatuses(undefined, issueType);
  const statusesFor = useTeamStatusesLookup();
  // Labels resolve per-item: each card carries its own teamId (see the task board).
  const labelsFor = useTeamLabelsLookup();

  const shared = issueSharedFilterParams(filters);

  const { data, isLoading } = useIssues({
    kind: [kind],
    // "Assigned to me" is strictly the assignee, never the creator. The sentinel
    // keeps that list empty (not everyone's) until the user has loaded; the
    // all-issues scope sends no `mine` at all, so the API returns the workspace.
    mine: isAll ? undefined : user?.id ?? '__none__',
    search: search || undefined,
    status: filters.status,
    // Assignee, creator and the two date windows — the block every board shares.
    ...shared,
    // Filtering by assignee only means something when the list isn't already one
    // person's (the API's `mine` wins over it anyway).
    assigneeId: isAll ? shared.assigneeId : undefined,
    severity: isBug ? (filters.severity as BugSeverity[] | undefined) : undefined,
    projectId: filters.projectId,
    roadmapItemId: isBug ? undefined : filters.roadmapItemId,
    // Only the list view orders itself. Sending `sort` makes the API drop the
    // stored `order`, so the board and the timeline must send neither param to
    // keep today's drag-position-first ordering exactly as it is.
    sort: isList && sort ? sort.field : undefined,
    dir: isList && sort ? sort.dir : undefined,
  });
  const items = data?.items ?? [];
  // Each card/row names its own cycle — at the default all-cycles scope that's the
  // only place it's stated. Resolved per-row like the labels above.
  const cycleFor = useCycleLookup(items.map((it) => it.teamId));
  // A board titled "All issues" must not hide a row it has no column for, so any
  // status present on a fetched issue but missing from the default team's set is
  // appended (see `extendColumns`).
  const columns = isAll
    ? extendColumns(defaultColumns, items, (teamId) => statusesFor(teamId, issueType))
    : defaultColumns;
  // The API caps a page at 100 (`PaginationDto`), like every other board here —
  // say so rather than looking complete.
  const capped = (data?.total ?? 0) > items.length;

  const setStatus = useSetIssueStatus();
  const remove = useDeleteIssue();

  // Both kinds open their own full create page, carrying the column when added
  // from one. Neither carries a team: this board spans teams, so a new issue
  // lands in the workspace default — which is what it already did.
  const openCreate = (status?: string) => {
    const base = isBug ? '/bugs/new' : '/tasks/new';
    navigate(status ? `${base}?status=${encodeURIComponent(status)}` : base);
  };

  // Only needed to label the filter options. Both scopes need people now: even
  // "Assigned to me" can be narrowed by who *opened* the issue.
  const { data: usersData } = useUsers({ limit: 100 }, canManageDelivery);
  const { data: projectsData } = useProjects({ limit: 100 });
  const { data: roadmaps } = useRoadmaps();

  // `?sv=<id>` names a saved view to open. `filters`/`search`/`sort` live in
  // React state (only `kind` and `view` ride in the URL), so applying a saved
  // view means writing that state back — there is nothing to restore from the
  // URL alone.
  const svId = params.get('sv');
  const { data: views } = useSavedViews();
  const activeView = views?.find((v) => v.id === svId);

  // Applies once per `sv` change — deliberately *not* keyed on `filters`,
  // `sort` etc., or every edit the user makes afterwards would immediately be
  // pulled back to the saved view.
  useEffect(() => {
    if (!svId) return;
    if (!views) return; // still loading — wait for the list rather than 404 early.
    if (!activeView) {
      // Deleted, or not shared with this user: open the default board instead
      // of a blank one, and say why.
      toast.error(t('savedViews.cannotOpen'));
      const next = new URLSearchParams(params);
      next.delete('sv');
      setParams(next, { replace: true });
      return;
    }
    // The stored query is never trusted as-is — it may predate a filter-shape
    // change or come from an older client (`CreateSavedViewDto.query` is only
    // `@IsObject()`-validated server-side). `sanitizeSavedViewQuery` defends
    // every field independently so a malformed one degrades to the board's
    // own default rather than crashing or wedging the filter state.
    const q = sanitizeSavedViewQuery(activeView);
    // A deleted project or backlog item must not blank the whole board — drop
    // just that stale id, keep the rest, and say so. Only these two
    // categories are checked: `severity` is a closed enum that can't go
    // stale, and a trustworthy valid set for `status` (team-specific,
    // depends on the *target* kind we're about to switch to) or `assigneeId`
    // (only loaded when `isAll && canManageDelivery`, and capped at 100)
    // isn't cheaply available here. Known gap: a stale `status`/`assigneeId`
    // filter is left in place — the board just shows no matches for it,
    // and per `FilterMenu.tsx`, the user's only way to remove a single stale
    // chip today is "Clear all" (no per-chip remove). `projectsData`/
    // `roadmaps` are also not yet guaranteed loaded the first time this runs
    // (they're independent queries fired alongside `views`) — when either is
    // still `undefined`, that category is simply skipped this pass rather
    // than treated as "nothing is valid", so a stale id can survive one
    // apply if its data hasn't arrived yet. This is a real, not hypothetical,
    // race window; deliberately not covered by `useEffect`'s deps below,
    // since re-running on every load of `projectsData`/`roadmaps` would risk
    // the same "pulled back after editing" loop `filters` is kept out for.
    const { filters: pruned, dropped } = pruneFilters(q.filters, {
      ...(projectsData ? { projectId: new Set(projectsData.items.map((p) => p.id)) } : {}),
      ...(roadmaps
        ? { roadmapItemId: new Set(roadmaps.flatMap((r) => (r.items ?? []).map((i) => i.id))) }
        : {}),
    });
    // `kind` and `view` are set together in one `setParams` call — see
    // `buildKindViewParams` above for why two separate calls (`setKind` then
    // `setView`) race and silently drop the kind change.
    if (q.kind !== kind || q.view !== view) {
      setParams(buildKindViewParams(params, q.kind, q.view), { replace: true });
    }
    setFilters(pruned);
    setSort(q.sort);
    setSearch(q.search);
    if (dropped) toast.warning(t('savedViews.someFiltersDropped'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svId, views]);

  const filterCategories: FilterCategory[] = [
    {
      id: 'status',
      label: t('roadmaps.status'),
      options: columns.map((c) => ({ id: c.key, label: c.label, color: c.color })),
    },
    // Severity is a bug-only axis; backlog item is task-only.
    ...(isBug
      ? [
          {
            id: 'severity',
            label: t('bugs.severity'),
            options: BUG_SEVERITIES.map((s) => ({
              id: s,
              label: BUG_SEVERITY_LABEL[s],
              color: BUG_SEVERITY_COLOR[s],
            })),
          },
        ]
      : [
          {
            id: 'roadmapItemId',
            label: t('filters.backlogItem'),
            searchable: true,
            // Flattened across roadmaps and prefixed, so same-named items stay distinct.
            options: (roadmaps ?? []).flatMap((r) =>
              (r.items ?? []).map((i) => ({ id: i.id, label: `${r.title} · ${i.title}` })),
            ),
          },
        ]),
    {
      id: 'projectId',
      label: t('filters.project'),
      searchable: true,
      options: (projectsData?.items ?? []).map((p) => ({ id: p.id, label: p.title })),
    },
    // Assignee · creator · created date · solved date — identical on every board.
    // Assignee only appears once the board isn't already one person's.
    ...issueSharedFilters({ user, users: usersData?.items, includeAssignee: isAll }),
  ];

  /** Issues don't persist ordering, so the drop slot is ignored — only the
   * destination column matters. */
  function onMove(id: string, toStatus: string) {
    const it = items.find((x) => x.id === id);
    if (it && it.status !== toStatus) setStatus.mutate({ id, status: toStatus });
  }

  // One detail URL for both kinds — `/issues/<ref>` works out the kind itself.
  const openIssue = (it: IssueDto) => navigate(`/issues/${it.shortId || it.id}`);

  return (
    <IssueBoardLayout
      title={isAll ? t('issues.allTitle') : t('tasks.assignedToMe')}
      subtitle={isAll ? t('issues.allSubtitle') : t('issues.mySubtitle')}
      search={{
        value: search,
        onChange: setSearch,
        placeholder: isBug ? t('bugs.search') : t('tasks.search'),
      }}
      filters={
        <div className="flex items-center gap-2 sm:gap-3">
          <KindSwitch value={kind} onChange={setKind} />
          <FilterMenu size="default" categories={filterCategories} value={filters} onChange={setFilters} />
        </div>
      }
      // One kind at a time, so severity is a real ordering exactly when the Kind
      // switch is on Bugs (`setKind` clears it on the way back to tasks).
      sort={isList ? <SortMenu value={sort} onChange={setSort} severity={isBug} /> : undefined}
      filtersEnd={
        <div className="flex flex-wrap items-center gap-2">
          <SavedViewBar
            kind={kind}
            view={view}
            filters={filters}
            sort={sort}
            search={search}
            activeView={activeView}
            onSaved={(id) => {
              const next = new URLSearchParams(params);
              next.set('sv', id);
              setParams(next, { replace: true });
            }}
          />
          {capped && (
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums">
                {items.length} / {data?.total}
              </span>{' '}
              {t('issues.cappedHint')}
            </p>
          )}
        </div>
      }
      view={{
        value: view,
        onChange: (v) => setView(v as 'board' | 'list' | 'timeline'),
        options: [
          { value: 'board', label: t('tasks.viewBoard'), icon: <LayoutGrid /> },
          { value: 'list', label: t('tasks.viewList'), icon: <List /> },
          { value: 'timeline', label: t('boards.viewTimeline'), icon: <CalendarRange /> },
        ],
      }}
      actions={
        canWrite ? (
          <Button onClick={() => openCreate()}>+ {isBug ? t('bugs.new') : t('tasks.new')}</Button>
        ) : undefined
      }
    >
      {isLoading ? (
        view === 'list' ? (
          <ListSkeleton inset />
        ) : view === 'timeline' ? (
          <TimelineSkeleton />
        ) : (
          <BoardSkeleton columns={columns.length || 4} />
        )
      ) : items.length === 0 ? (
        <div className="mx-4 rounded-xl border border-dashed p-8 text-center md:mx-8">
          <p className="text-muted-foreground">
            {isAll ? t('issues.emptyAll') : isBug ? t('bugs.empty') : t('tasks.none')}
          </p>
          {canWrite && (
            <Button size="sm" className="mt-3" onClick={() => openCreate()}>
              {isBug ? t('bugs.new') : t('tasks.new')}
            </Button>
          )}
        </div>
      ) : view === 'board' ? (
        <KanbanBoard
          columns={columns}
          items={items}
          getId={(it) => it.id}
          getColumnKey={(it) => it.status}
          // IssueDto is a documented superset of Task/BugDto, but widens
          // status→string and severity→''|BugSeverity, so the narrower card props
          // reject a structural assign — the runtime shape is identical, hence the cast.
          renderCard={(it, overlay) =>
            isBug ? (
              <BugCard
                bug={it as unknown as BugDto}
                labels={labelsFor(it.teamId)}
                cycle={cycleFor(it.cycleId)}
                overlay={overlay}
              />
            ) : (
              <TaskCard
                task={it as unknown as TaskDto}
                labels={labelsFor(it.teamId)}
                cycle={cycleFor(it.cycleId)}
                overlay={overlay}
              />
            )
          }
          onMove={onMove}
          disabled={!canWrite}
          onCardClick={openIssue}
          renderCardToolbar={
            canWrite
              ? (it) => (
                  <KanbanCardToolbar
                    editLabel={t('common.edit')}
                    removeLabel={t('common.delete')}
                    onEdit={() => openIssue(it)}
                    onRemove={() => {
                      if (confirm(isBug ? t('bugs.confirmDelete') : t('tasks.confirmDelete')))
                        remove.mutate(it.id);
                    }}
                  />
                )
              : undefined
          }
          onColumnAdd={canWrite ? (col) => openCreate(col.key) : undefined}
          addLabel={isBug ? t('bugs.addToColumn') : t('tasks.addToColumn')}
        />
      ) : view === 'list' ? (
        <div className={cn('min-h-0 flex-1 overflow-y-auto pb-6', BOARD_GUTTER)}>
          <IssueList
            items={items}
            columns={columns}
            labelsFor={labelsFor}
            cycleFor={cycleFor}
            isBug={isBug}
            onOpen={openIssue}
          />
        </div>
      ) : (
        <div className={cn('min-h-0 flex-1 overflow-y-auto pb-6 pt-1', BOARD_GUTTER)}>
          <IssueTimelineView items={items} issueType={issueType} />
        </div>
      )}
    </IssueBoardLayout>
  );
}

/** List view — grouped by status column, mirroring the task/bug lists so all
 * three read as siblings. Leads with the bug's severity dot or a task glyph. */
function IssueList({
  items,
  columns,
  labelsFor,
  cycleFor,
  isBug,
  onOpen,
}: {
  items: IssueDto[];
  columns: TeamStatusConfig[];
  labelsFor: (teamId: string | undefined) => TaskLabelConfig[];
  cycleFor: (cycleId: string | undefined) => CycleDto | undefined;
  isBug: boolean;
  onOpen: (item: IssueDto) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {columns.map((col) => {
        const list = items.filter((it) => it.status === col.key);
        if (list.length === 0) return null;
        return (
          <section key={col.key}>
            <div className="mb-2 flex items-center gap-2">
              <span className="size-2 rounded-full" style={{ backgroundColor: col.color }} aria-hidden />
              <h2 className="text-sm font-medium text-foreground">{col.label}</h2>
              <span className="text-xs tabular-nums text-muted-foreground">{list.length}</span>
            </div>
            <div className="rounded-xl border bg-card p-2 text-card-foreground shadow-sm">
              {list.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onOpen(it)}
                  className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-foreground transition-colors hover:bg-accent [&:not(:last-child)]:border-b"
                >
                  {isBug && it.severity ? (
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: BUG_SEVERITY_COLOR[it.severity] }}
                      title={BUG_SEVERITY_LABEL[it.severity]}
                    />
                  ) : (
                    <Icon name="tasks" size={14} className="shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{it.title}</span>
                  {/* Hidden on mobile, like the labels beside it — a row has room
                      for the title and the assignee first. */}
                  <IssueCycleChip
                    cycle={cycleFor(it.cycleId)}
                    className="hidden shrink-0 sm:flex"
                  />
                  <LabelChips
                    keys={it.labelKeys}
                    labels={labelsFor(it.teamId)}
                    max={3}
                    className="hidden shrink-0 sm:flex"
                  />
                  {it.shortId && (
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{it.shortId}</span>
                  )}
                  <AssigneeBadge
                    assignees={it.assignees}
                    unassignedLabel={t('tasks.unassigned')}
                    className="max-w-[35%] shrink-0"
                  />
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
