import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Badge,
  Button,
  Menu,
  ProgressBar,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type MenuItem,
} from '@/components/ui';
import { BOARD_GUTTER } from '@/components/IssueBoardLayout';
import { CycleIcon } from '@/features/cycles/CycleIcon';
import { cycleStatusBadge, daysLeftLabel, shortDay } from '@/features/cycles/dates';
import { doneKeyOf } from '@/features/my-team/workload';
import { useTeamStatusesLookup } from '@/features/teams/api';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { CycleStatus, TeamIssueType } from '@/types/enums';
import type { TaskDto } from '@/types/dto';
import {
  SPRINT_ALL,
  SPRINT_CURRENT,
  SPRINT_NONE,
  type RoadmapSprint,
  type SprintScope,
} from '../useRoadmapSprints';

/** "starts Aug 17" / "4 days left" / "" — the same three cases `cycleTimeHint`
 *  draws for a team cycle, over a merged window rather than one team's row. */
function timeHint(sprint: RoadmapSprint): string {
  if (sprint.status === CycleStatus.ACTIVE) return daysLeftLabel(sprint.endDate);
  if (sprint.status === CycleStatus.UPCOMING) return `${t('cycles.starts')} ${shortDay(sprint.startDate)}`;
  return '';
}

/**
 * A backlog item's or task's sprint, as a chip. Nothing renders when there is no
 * sprint — an unscheduled item shows no chip rather than an empty one, so the
 * absence itself reads as "not planned yet".
 */
export function SprintChip({
  sprints,
  className,
}: {
  /** One task's single sprint, or a backlog item's (it may span two). */
  sprints: RoadmapSprint[];
  className?: string;
}) {
  if (sprints.length === 0) return null;
  // Newest last from the hook; the newest is the one being worked, so lead with it.
  const lead = sprints[sprints.length - 1];
  const extra = sprints.length - 1;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant={lead.status === CycleStatus.ACTIVE ? 'secondary' : 'muted'}
          className={cn('min-w-0 max-w-full gap-1 py-0 font-normal', className)}
        >
          <CycleIcon className="size-3.5 shrink-0 [&>svg]:size-3" />
          <span className="truncate">{lead.name}</span>
          {extra > 0 && <span className="shrink-0 tabular-nums opacity-70">+{extra}</span>}
        </Badge>
      </TooltipTrigger>
      {/* The chip shows only a name, so the window it stands for lives here — the
          whole point of hovering it. One line per sprint rather than a joined
          string: a label is itself "name · dates", so joining two with the same
          separator read as four things instead of two. Oldest → newest, matching
          the order the work actually happened in. */}
      <TooltipContent className="max-w-xs">
        {sprints.map((s) => (
          <div key={s.key} className="whitespace-nowrap">
            <span className="font-medium">{s.name}</span>
            <span className="opacity-80">
              {' · '}
              {shortDay(s.startDate)} – {shortDay(s.endDate)}
            </span>
            {s.status === CycleStatus.ACTIVE && (
              <span className="opacity-80">{` · ${t('cycles.current')}`}</span>
            )}
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

/** What a sprint actually contains on this roadmap — counted from the linked
 *  tasks, so it can never disagree with the board below it. */
export interface SprintRollup {
  items: number;
  tasks: number;
  done: number;
  points: number;
  donePoints: number;
}

/**
 * Roll up one sprint's linked tasks. "Done" is the owning team's terminal column
 * (`doneKeyOf`) rather than a hardcoded `done`, so a team that renamed or added
 * columns still reports honestly. Points are story points; tasks left unsized
 * simply contribute nothing, which is why the banner leads with counts.
 */
export function useSprintRollup(tasks: TaskDto[], sprint: RoadmapSprint | undefined): SprintRollup {
  const statusesFor = useTeamStatusesLookup();
  const empty = { items: 0, tasks: 0, done: 0, points: 0, donePoints: 0 };
  if (!sprint) return empty;

  const cycleIds = new Set(sprint.cycleIds);
  const items = new Set<string>();
  const rollup = { ...empty };
  for (const tk of tasks) {
    if (!tk.cycleId || !cycleIds.has(tk.cycleId)) continue;
    if (tk.roadmapItemId) items.add(tk.roadmapItemId);
    const points = tk.estimate > 0 ? tk.estimate : 0;
    rollup.tasks += 1;
    rollup.points += points;
    if (tk.status === doneKeyOf(statusesFor(tk.teamId, TeamIssueType.TASK))) {
      rollup.done += 1;
      rollup.donePoints += points;
    }
  }
  rollup.items = items.size;
  return rollup;
}

/**
 * The roadmap's sprint bar — **the** sprint control, display and picker in one.
 *
 * It condenses one sprint into a line: identity and status, the window and how
 * long is left, then what this roadmap actually committed to it — backlog items,
 * tasks, finished, points — with `‹ ›` to step through the calendar. Pick a
 * completed sprint and the same line is a retro summary; pick the current one
 * and it's a live commitment. Unlike a team board's `CycleBoardBanner` the
 * numbers here span **every** team on the roadmap, because a backlog item is
 * delivered by several of them at once.
 *
 * The identity group is itself the scope menu, so the roadmap has exactly one
 * cycle control rather than a bar that *shows* the sprint plus a Select beside it
 * that *picks* it — those two spelled the same window twice ("Cycle 1 · Jul 26 –
 * Aug 8 · Current" is just this line re-typed) and the roadmap has nothing else
 * to narrow, so the whole toolbar row existed to hold the duplicate. A team board
 * keeps its Select because there it shares a row with search + filters and reads
 * as one filter among several.
 *
 * Because it's the only way to change scope it must render for **every** scope,
 * not just a focused sprint: `‹ ›` only ever reach a neighbouring sprint, so a
 * bar that vanished on All / Not-in-a-sprint would strand the board with no way
 * back. What it drops in those states is the rollup — there is no single sprint
 * to report on, and a number contradicting the list below is worse than none.
 *
 * Renders nothing until at least one sprint exists, so a roadmap whose teams
 * don't run cycles looks exactly as it did before sprints landed.
 */
export function RoadmapSprintBanner({
  scope,
  sprints,
  value,
  unplannedCount,
  tasks,
  onChange,
}: {
  /** What's actually in effect — so a `current` that can't resolve (a cooldown
   *  gap) reads as "All sprints" rather than lying. */
  scope: SprintScope;
  sprints: RoadmapSprint[];
  /** The raw `?sprint=` param, kept so a resolvable `current` stays "Current". */
  value: string;
  /** Backlog items no sprint has picked up — the "did I forget one?" number. */
  unplannedCount: number;
  /** Every task linked to this roadmap (unfiltered — the rollup does its own). */
  tasks: TaskDto[];
  onChange: (value: string) => void;
}) {
  const sprint = scope.kind === 'sprint' ? scope.sprint : undefined;
  const rollup = useSprintRollup(tasks, sprint);
  if (sprints.length === 0) return null;

  const hasCurrent = sprints.some((s) => s.status === CycleStatus.ACTIVE);
  // Which menu row carries the ✓. Mirrors the displayed truth, so an unresolvable
  // `current` ticks "All sprints" — the scope the board is actually showing.
  const picked =
    value === SPRINT_CURRENT && !hasCurrent
      ? SPRINT_ALL
      : sprint
        ? sprint.key
        : scope.kind === 'none'
          ? SPRINT_NONE
          : SPRINT_ALL;

  // Every row keeps an icon slot so the ticked and unticked labels line up.
  const row = (key: string, label: string): MenuItem => ({
    label,
    icon: picked === key ? <Check className="size-4" /> : <span />,
    closeOnSelect: true,
    onClick: () => onChange(key),
  });
  const items: MenuItem[] = [
    ...(hasCurrent ? [row(SPRINT_CURRENT, t('sprints.current'))] : []),
    row(SPRINT_ALL, t('sprints.all')),
    row(
      SPRINT_NONE,
      unplannedCount ? `${t('sprints.none')} (${unplannedCount})` : t('sprints.none'),
    ),
    { label: '', separator: true },
    ...sprints.map((s) =>
      row(s.key, s.status === CycleStatus.ACTIVE ? `${s.label} · ${t('cycles.current')}` : s.label),
    ),
  ];

  // Newest-first, so the neighbour toward the future sits at the previous index —
  // `‹` steps back in time, `›` forward. Same convention as the cycle banner.
  const idx = sprint ? sprints.findIndex((s) => s.key === sprint.key) : -1;
  const newer = idx > 0 ? sprints[idx - 1] : undefined;
  const older = idx >= 0 && idx < sprints.length - 1 ? sprints[idx + 1] : undefined;

  const badge = sprint ? cycleStatusBadge(sprint.status) : undefined;
  const hint = sprint ? timeHint(sprint) : '';
  const pct = rollup.tasks ? (rollup.done / rollup.tasks) * 100 : 0;

  return (
    <div className={cn('shrink-0', BOARD_GUTTER)}>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-xl border bg-card px-2.5 py-2 text-card-foreground shadow-sm">
        <div className="flex min-w-0 items-center gap-1">
          {/* Stepping is only meaningful between sprints, so All / Not-in-a-sprint
              get no arrows at all rather than two permanently dead buttons. */}
          {sprint && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              onClick={() => older && onChange(older.key)}
              disabled={!older}
              aria-label={t('cycles.prevCycle')}
            >
              <ChevronLeft className="size-4" />
            </Button>
          )}
          <Menu
            align="left"
            triggerClassName="min-w-0 rounded-md px-1.5 py-1 transition-colors hover:bg-accent data-[state=open]:bg-accent"
            trigger={
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-left">
                <CycleIcon className="text-muted-foreground" />
                {sprint ? (
                  <>
                    <span className="text-sm font-semibold">{sprint.name}</span>
                    <Badge variant={badge!.variant}>{badge!.label}</Badge>
                    <span className="text-sm text-muted-foreground">
                      {shortDay(sprint.startDate)} – {shortDay(sprint.endDate)}
                      {hint && <span className="ml-1.5 whitespace-nowrap text-xs">· {hint}</span>}
                    </span>
                    {/* How many teams' calendars this one window covers. Silent
                        for a single team — naming it would only be noise. */}
                    {sprint.teamIds.length > 1 && (
                      <Badge variant="muted" className="font-normal">
                        {t('sprints.teams').replace('{n}', String(sprint.teamIds.length))}
                      </Badge>
                    )}
                  </>
                ) : (
                  // No single sprint in view: the bar names the scope instead, so
                  // it still reads as "what am I looking at" and stays clickable.
                  <span className="text-sm font-semibold">
                    {scope.kind === 'none' ? t('sprints.none') : t('sprints.all')}
                    {scope.kind === 'none' && unplannedCount > 0 && (
                      <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
                        ({unplannedCount})
                      </span>
                    )}
                  </span>
                )}
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="sr-only">{t('sprints.filterLabel')}</span>
              </span>
            }
            items={items}
          />
          {sprint && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              onClick={() => newer && onChange(newer.key)}
              disabled={!newer}
              aria-label={t('cycles.nextCycle')}
            >
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>

        {/* What this roadmap put into the sprint, and how much of it landed. */}
        {sprint && (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <ProgressBar value={pct} className="h-1.5 w-24 sm:w-32" />
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(pct)}%
              </span>
            </div>
            <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
              <span className="font-medium text-foreground">{rollup.items}</span>
              {` ${t('sprints.backlogItems')}`}
              <span className="ml-2">
                <span className="font-medium text-foreground">{rollup.done}</span>
                {`/${rollup.tasks} ${t('sprints.tasksDone')}`}
              </span>
              {rollup.points > 0 && (
                <span className="ml-2">
                  {rollup.donePoints}/{rollup.points} {t('cycles.pts')}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
