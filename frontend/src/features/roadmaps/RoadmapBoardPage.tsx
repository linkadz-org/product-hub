import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  Gauge,
  LayoutGrid,
  MoreHorizontal,
  SquareArrowOutUpRight,
  Table2,
  Target,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Menu, type MenuItem } from '@/components/ui';
import { BoardSkeleton } from '@/components/Skeletons';
import { CenteredPageLayout } from '@/layouts/shared';
import { cn } from '@/lib/utils';
import { firstImageUrl } from '@/lib/editorjs';
import { t } from '@/i18n';
import { BOARD_GUTTER, IssueBoardLayout } from '@/components/IssueBoardLayout';
import { BoardCard, BoardCardAge, KanbanBoard, KanbanCardToolbar } from '@/components/KanbanBoard';
import {
  DEFAULT_ROADMAP_COLUMNS,
  ROADMAP_DIFFICULTY_COLOR,
  ROADMAP_DIFFICULTY_LABEL,
  ROADMAP_ITEM_STATUS_LABEL,
  RoadmapDifficulty,
  RoadmapItemStatus,
} from '@/types/enums';
import { RoadmapWorkflowView } from './components/RoadmapWorkflowView';
import { RoadmapGanttView } from './components/RoadmapGanttView';
import { RoadmapSprintBanner, SprintChip } from './components/RoadmapSprintControls';
import {
  itemInScope,
  resolveScope,
  SPRINT_ALL,
  SPRINT_DEFAULT,
  useRoadmapSprints,
  type RoadmapSprint,
} from './useRoadmapSprints';
import { sprintMoveMenu, useSprintMove } from './useSprintMove';
import type { RoadmapDto, RoadmapItem } from '@/types/dto';
import { RoadmapColumnsDialog } from './components/RoadmapColumnsDialog';
import { ShareLinkDialog } from '@/components/ShareLinkDialog';
import { RoadmapRiceChart } from './components/RoadmapRiceChart';
import { RoadmapRiceTable } from './components/RoadmapRiceTable';
import {
  useDeleteRoadmap,
  useReplaceRoadmapItems,
  useRoadmap,
  useSetRoadmapSharing,
  useUpdateRoadmap,
} from './api';

const STATUS_VARIANT: Record<RoadmapItemStatus, 'muted' | 'warning' | 'success'> = {
  [RoadmapItemStatus.IDEA]: 'muted',
  [RoadmapItemStatus.PLANNED]: 'muted',
  [RoadmapItemStatus.IN_PROGRESS]: 'warning',
  [RoadmapItemStatus.DONE]: 'success',
};

/** A fresh item for create-and-open. Title starts empty (shown as "Untitled"
 *  on the card); the new item's page autofocuses the title to fill in. */
function emptyRoadmapItem(id: string, phase: string): RoadmapItem {
  return {
    id,
    title: '',
    description: '',
    phase,
    status: RoadmapItemStatus.IDEA,
    difficulty: RoadmapDifficulty.MEDIUM,
    reach: 3,
    impact: 3,
    confidence: 3,
    effort: 3,
    progress: 0,
    rice: 9,
    imageUrl: '',
    startDate: '',
    endDate: '',
    assignees: [],
    milestoneId: '',
    objectiveId: '',
    keyResultId: '',
    okrLabel: '',
  };
}

/** Roadmap item card visual — shared by the column list and the lifted drag overlay. */
export function RoadmapCard({
  item,
  overlay = false,
  sprints = [],
}: {
  item: RoadmapItem;
  overlay?: boolean;
  /** The sprints this item has work in — derived, so the public read-only board
   *  passes none and simply shows no chip. */
  sprints?: RoadmapSprint[];
}) {
  // Cover = the item's first description image. Prefer the persisted `imageUrl`,
  // but fall back to parsing the description so items saved before covers existed
  // (and the public read-only view) still show one.
  const cover = item.imageUrl || firstImageUrl(item.description);
  return (
    <BoardCard
      overlay={overlay}
      cover={cover || undefined}
      title={item.title || t('roadmaps.untitled')}
      titleTrailing={
        <Badge variant="secondary" className="font-mono" title="RICE score">
          {item.rice}
        </Badge>
      }
      labels={
        item.okrLabel || sprints.length ? (
          // Wraps: a card is narrow and a half-clipped chip reads as broken.
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {/* Which sprint(s) the item's tasks are committed to — first, because
                "when" is what you scan a filtered board for. */}
            <SprintChip sprints={sprints} />
            {item.okrLabel && (
              // Linked OKR — informational chip (the denormalized objective/KR title).
              <Badge variant="muted" className="min-w-0 max-w-full gap-1 font-normal" title={item.okrLabel}>
                <Target className="size-3 shrink-0 text-primary" aria-hidden />
                <span className="truncate">{item.okrLabel}</span>
              </Badge>
            )}
          </div>
        ) : undefined
      }
      metaLeading={
        <Badge variant={STATUS_VARIANT[item.status]}>
          {ROADMAP_ITEM_STATUS_LABEL[item.status]}
        </Badge>
      }
      metaTrailing={
        <>
          {/* Difficulty — same dot colour as the item dialog (semantic tokens). */}
          <span className="flex items-center gap-1" title={t('roadmaps.difficulty')}>
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: ROADMAP_DIFFICULTY_COLOR[item.difficulty] }}
              aria-hidden
            />
            {ROADMAP_DIFFICULTY_LABEL[item.difficulty]}
          </span>
          {/* Age since creation — how long the item has sat, e.g. "5d" / "10d". */}
          <BoardCardAge createdAt={item.createdAt} />
        </>
      }
      progress={item.progress}
    />
  );
}

export function RoadmapBoardPage() {
  const { roadmapId } = useParams<{ roadmapId: string }>();
  const { data: roadmap, isLoading } = useRoadmap(roadmapId);

  if (isLoading) {
    return <BoardSkeleton />;
  }
  if (!roadmap) {
    return (
      <CenteredPageLayout>
        <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          {t('roadmaps.notFound')}{' '}
          <Link
            to="/roadmaps"
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t('roadmaps.title')}
          </Link>
        </div>
      </CenteredPageLayout>
    );
  }
  // Split here so the board's own hooks (the sprint layer needs the roadmap's id)
  // run unconditionally — the guards above used to sit between the hooks and the
  // render, which is exactly the shape that forces `roadmap!` everywhere.
  return <RoadmapBoard roadmap={roadmap} />;
}

function RoadmapBoard({ roadmap }: { roadmap: RoadmapDto }) {
  const navigate = useNavigate();
  const { isAdmin, canWrite, canManageDelivery } = useAuth();

  const replaceItems = useReplaceRoadmapItems();
  const deleteRoadmap = useDeleteRoadmap();
  const update = useUpdateRoadmap();
  const setSharing = useSetRoadmapSharing();

  const [columnsOpen, setColumnsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sortRice, setSortRice] = useState(false);
  // Persist the board/chart view in the URL (?view=chart) so it survives reloads
  // and is shareable; `board` is the default and kept out of the query for clean URLs.
  const [searchParams, setSearchParams] = useSearchParams();
  const viewParam = searchParams.get('view');
  const view: 'board' | 'chart' | 'table' | 'workflow' | 'gantt' =
    viewParam === 'chart'
      ? 'chart'
      : viewParam === 'table'
        ? 'table'
        : viewParam === 'workflow'
          ? 'workflow'
          : viewParam === 'gantt'
            ? 'gantt'
            : 'board';
  const setView = (v: 'board' | 'chart' | 'table' | 'workflow' | 'gantt') => {
    const next = new URLSearchParams(searchParams);
    if (v === 'board') next.delete('view');
    else next.set('view', v);
    setSearchParams(next, { replace: true });
  };

  // ── Sprint scope ───────────────────────────────────────────────────────────
  // `?sprint=` holds a **sentinel** (`current`) rather than the resolved window,
  // so a link shared today still opens on whatever is current when it's clicked —
  // the same trick the team boards' `?cycle=` uses. `current` is the default and
  // stays out of the URL; `all` is what an explicitly-widened board writes.
  const {
    sprints,
    sprintsForItem,
    sprintForTask,
    tasks,
    tasksByItem,
    isLoading: sprintsLoading,
  } = useRoadmapSprints(roadmap.id);
  const moveToSprint = useSprintMove(sprintForTask);
  const sprintParam = searchParams.get('sprint') ?? SPRINT_DEFAULT;
  const scope = resolveScope(sprints, sprintParam);
  const setSprint = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v === SPRINT_DEFAULT) next.delete('sprint');
    else next.set('sprint', v);
    setSearchParams(next, { replace: true });
  };
  // The timeline's second reading of the same data — bands on the axis (default)
  // or rows stacked under sprint headers. In the URL like `?view=`, because
  // "here's what each sprint built" is exactly the link you paste into a review.
  const groupBySprint = searchParams.get('group') === 'sprint';
  const setGroupBySprint = (on: boolean) => {
    const next = new URLSearchParams(searchParams);
    if (on) next.set('group', 'sprint');
    else next.delete('group');
    setSearchParams(next, { replace: true });
  };

  const allItems = roadmap.items ?? [];
  const columns = roadmap.columns?.length ? roadmap.columns : DEFAULT_ROADMAP_COLUMNS;
  // Scoping is **strict** — an item with no work in the sprint drops out of every
  // column, Now through Later — so the count of items nobody has scheduled goes on
  // the filter itself. That's the one thing strict filtering can hide, and it's a
  // click away rather than a thing you have to remember to check.
  const unplannedCount = allItems.filter((i) => sprintsForItem(i.id).length === 0).length;
  // Until the tasks *and* cycles have landed nothing has a sprint yet, so filtering
  // mid-flight would blank the board and then refill it — worse, it would trip the
  // "nothing in this sprint" panel on data that simply hadn't arrived.
  const scoped = !sprintsLoading && scope.kind !== 'all';
  const items = scoped ? allItems.filter((i) => itemInScope(sprintsForItem(i.id), scope)) : allItems;
  // Sorting the whole array by RICE and then filtering per column gives the same
  // per-column order as sorting each column, so the board can take it directly.
  const boardItems = sortRice ? [...items].sort((a, b) => b.rice - a.rice) : items;

  /** Writes always go through the **unfiltered** array: the board only ever shows
   *  a slice of it, and saving the slice would delete everything out of scope. */
  function save(next: RoadmapItem[]) {
    replaceItems.mutate({ id: roadmap.id, items: next });
  }
  /** Open by ref (`…/items/RM-6HCUHKX`) — callers hand us the uuid they're
   *  holding, so the ref is looked up here rather than at every call site.
   *  Falls back to the uuid for items minted before refs existed. */
  const openItem = (id: string) => {
    const ref = allItems.find((i) => i.id === id)?.shortId || id;
    navigate(`/roadmaps/${roadmap.id}/items/${ref}`);
  };
  /** Create-and-open: a new "Untitled" item is added to the column and its page
   *  opens immediately to fill in — no dialog. */
  function createItem(phase: string) {
    const id = crypto.randomUUID();
    save([...allItems, emptyRoadmapItem(id, phase)]);
    navigate(`/roadmaps/${roadmap.id}/items/${id}`);
  }
  function removeItem(id: string) {
    if (confirm(t('roadmaps.confirmDeleteItem'))) save(allItems.filter((i) => i.id !== id));
  }
  /**
   * A card's right-click menu. Re-committing an item to another cycle is the one
   * board action with no cheap home: it isn't a drag (columns are phases, not
   * cycles) and it isn't an edit (the item stores no cycle — its *tasks* do), so
   * the accelerator is where it belongs. Open/Delete ride along because a
   * one-row context menu reads like a bug; both already exist on the hover
   * toolbar, so nothing here is right-click-only.
   */
  function cardMenuItems(item: RoadmapItem): MenuItem[] {
    const itemTasks = tasksByItem.get(item.id) ?? [];
    return [
      {
        label: t('common.openFull'),
        icon: <SquareArrowOutUpRight className="size-4" />,
        closeOnSelect: true,
        onClick: () => openItem(item.id),
      },
      sprintMoveMenu({
        itemSprints: sprintsForItem(item.id),
        sprints,
        tasks: itemTasks,
        onPick: (target) => moveToSprint.requestMove(itemTasks, target),
      }),
      { label: '', separator: true },
      {
        label: t('common.delete'),
        icon: <Trash2 className="size-4" />,
        danger: true,
        closeOnSelect: true,
        onClick: () => removeItem(item.id),
      },
    ];
  }
  /** Reorder is persisted as the items array's order, so a move splices the
   * dragged item into the raw array — not the RICE-sorted view, and not the
   * sprint-filtered one (whose neighbours are only some of the real ones). */
  function onMove(id: string, toPhase: string, overId: string | null) {
    const dragged = allItems.find((i) => i.id === id);
    if (!dragged) return;
    const moved = { ...dragged, phase: toPhase };

    const without = allItems.filter((i) => i.id !== id);
    if (overId) {
      const idx = without.findIndex((i) => i.id === overId);
      without.splice(idx < 0 ? without.length : idx, 0, moved);
    } else {
      // Dropped on a column's empty area → append after that column's last item.
      let insertAt = without.length;
      for (let k = without.length - 1; k >= 0; k--) {
        if (without[k].phase === toPhase) {
          insertAt = k + 1;
          break;
        }
      }
      without.splice(insertAt, 0, moved);
    }
    save(without);
  }

  return (
    // Same shell as every team board now — the view switch, title and actions
    // are the layout's job, so this page only describes what goes in them.
    <IssueBoardLayout
      title={roadmap.title}
      subtitle={roadmap.description}
      titleLabel={t('roadmaps.rename')}
      // Mirrors `@Roles(ADMIN, TESTER, PRODUCT)` on `PATCH /roadmaps/:id` —
      // the same gate the board's drag already uses.
      onTitleChange={
        canWrite ? (title) => update.mutate({ id: roadmap.id, input: { title } }) : undefined
      }
      view={{
        value: view,
        onChange: (v) => setView(v as 'board' | 'chart' | 'table' | 'workflow' | 'gantt'),
        options: [
          { value: 'board', label: t('roadmaps.viewBoard'), icon: <LayoutGrid /> },
          { value: 'chart', label: t('roadmaps.viewChart'), icon: <BarChart3 /> },
          { value: 'table', label: t('roadmaps.viewTable'), icon: <Table2 /> },
          { value: 'workflow', label: t('roadmaps.viewWorkflow'), icon: <Gauge /> },
          { value: 'gantt', label: t('roadmaps.viewGantt'), icon: <CalendarDays /> },
        ],
      }}
      // One scope control for all five views, and it lives in the banner — the
      // roadmap has nothing to *narrow*, so it gets no toolbar row at all (a lone
      // Select there only restated the sprint the banner already named).
      banner={
        <RoadmapSprintBanner
          scope={scope}
          sprints={sprints}
          value={sprintParam}
          unplannedCount={unplannedCount}
          tasks={tasks}
          onChange={setSprint}
        />
      }
      actions={
        <>
          {view === 'gantt' && (
            <Button
              variant={groupBySprint ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setGroupBySprint(!groupBySprint)}
              disabled={sprints.length === 0}
            >
              {t('sprints.groupBySprint')}
            </Button>
          )}
          {view === 'board' && (
            <Button
              variant={sortRice ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setSortRice((v) => !v)}
            >
              {t('roadmaps.sortRice')}
            </Button>
          )}
          {(canManageDelivery || isAdmin) && (
            <Menu
              align="right"
              triggerClassName="size-8 rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              trigger={
                <>
                  <MoreHorizontal className="size-4" aria-hidden />
                  <span className="sr-only">{t('common.more')}</span>
                </>
              }
              items={[
                ...(canManageDelivery
                  ? [
                      { label: t('roadmaps.manageColumns'), onClick: () => setColumnsOpen(true) },
                      { label: t('share.share'), onClick: () => setShareOpen(true) },
                    ]
                  : []),
                ...(isAdmin
                  ? [
                      {
                        label: t('roadmaps.delete'),
                        danger: true,
                        onClick: () => {
                          if (confirm(t('roadmaps.confirmDelete')))
                            deleteRoadmap.mutate(roadmap.id, {
                              onSuccess: () => navigate('/roadmaps'),
                            });
                        },
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </>
      }
    >
      {/* Strict scoping can empty the board legitimately — say so, rather than
          leaving five blank columns that look like a failed load. */}
      {scoped && items.length === 0 && allItems.length > 0 ? (
        <div className={cn('min-h-0 flex-1 overflow-y-auto py-4 md:py-6', BOARD_GUTTER)}>
          <div className="rounded-xl border border-dashed p-10 text-center">
            <p className="text-sm font-medium text-foreground">
              {scope.kind === 'none' ? t('sprints.emptyNone') : t('sprints.emptyScoped')}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {scope.kind === 'none' ? t('sprints.emptyNoneHint') : t('sprints.emptyScopedHint')}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => setSprint(SPRINT_ALL)}
            >
              {t('sprints.all')}
            </Button>
          </div>
        </div>
      ) : view === 'board' ? (
        <KanbanBoard
          columns={columns}
          items={boardItems}
          getId={(i) => i.id}
          getColumnKey={(i) => i.phase}
          renderCard={(item, overlay) => (
            <RoadmapCard item={item} overlay={overlay} sprints={sprintsForItem(item.id)} />
          )}
          onMove={onMove}
          disabled={!canWrite}
          onCardClick={(item) => openItem(item.id)}
          renderCardToolbar={
            canWrite
              ? (item) => (
                  <KanbanCardToolbar
                    editLabel={t('common.edit')}
                    removeLabel={t('common.delete')}
                    onEdit={() => openItem(item.id)}
                    onRemove={() => removeItem(item.id)}
                  />
                )
              : undefined
          }
          cardMenuItems={canWrite ? cardMenuItems : undefined}
          onColumnAdd={canWrite ? (col) => createItem(col.key) : undefined}
          addLabel={t('roadmaps.addItem')}
        />
      ) : (
        <div className={cn('min-h-0 flex-1 overflow-y-auto py-4 md:py-6', BOARD_GUTTER)}>
          {view === 'chart' ? (
            <div className="mx-auto w-full sm:w-1/2">
              <RoadmapRiceChart items={items} columns={columns} />
            </div>
          ) : view === 'workflow' ? (
            <RoadmapWorkflowView items={items} sprintsForItem={sprintsForItem} />
          ) : view === 'gantt' ? (
            // The timeline peeks a row in a drawer rather than navigating — it owns
            // both drawers, so it needs no open-item callback from here.
            <RoadmapGanttView
              roadmapId={roadmap.id}
              items={items}
              allItems={allItems}
              columns={columns}
              sprints={sprints}
              scope={scope}
              groupBySprint={groupBySprint}
            />
          ) : (
            <RoadmapRiceTable
              items={items}
              columns={columns}
              sprintsForItem={sprintsForItem}
              onOpen={(item) => openItem(item.id)}
            />
          )}
        </div>
      )}

      {columnsOpen && (
        <RoadmapColumnsDialog
          open={columnsOpen}
          onClose={() => setColumnsOpen(false)}
          roadmapId={roadmap.id}
          columns={columns}
          // The unfiltered list: deleting a column has to rehome **every** item
          // sitting in it, not just the ones the current sprint scope shows.
          items={allItems}
        />
      )}
      {shareOpen && (
        <ShareLinkDialog
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          title={t('share.titleRoadmap')}
          hint={t('share.roadmapHint')}
          publicPath="roadmaps"
          enabled={roadmap.publicEnabled}
          publicToken={roadmap.publicToken}
          pending={setSharing.isPending}
          onToggle={(enabled) => setSharing.mutate({ id: roadmap.id, enabled })}
        />
      )}
      {/* Asks before a cycle move drags finished work out of a closed cycle. Lives
          here rather than in the menu because the menu is gone by the time it
          opens — a Radix popover unmounts on select. */}
      {moveToSprint.dialog}
    </IssueBoardLayout>
  );
}
