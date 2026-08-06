import { useState } from 'react';
import { t } from '@/i18n';
import { formatDate } from '@/lib/format';
import { AssigneeBadge } from '@/components/AssigneeBadge';
import { GanttChart, GanttChip, firstEpoch, isEpoch, toEpoch, type GanttRow } from '@/components/GanttChart';
import { LabelChips } from '@/features/labels/LabelChips';
import { TeamChip, type TeamChipTeam } from '@/features/teams/TeamChip';
import { useTeamLabelsLookup, useTeamLookup, useTeamStatusesLookup } from '@/features/teams/api';
import {
  BUG_SEVERITY_COLOR,
  BUG_SEVERITY_LABEL,
  TeamIssueType,
  type BugSeverity,
  type TaskLabelConfig,
  type TeamStatusConfig,
} from '@/types/enums';
import type { IssueAssigneeDto } from '@/types/dto';
import { IssuePeekDrawer, type IssuePeek } from './IssuePeekDrawer';

/**
 * The subset of a task/bug a timeline row needs. Both `TaskDto` and `BugDto`
 * satisfy it structurally (bugs simply have no `dueDate`), so a board can pass
 * its rows straight in.
 */
export interface IssueTimelineItem {
  id: string;
  shortId?: string;
  title: string;
  status: string;
  teamId?: string;
  startDate?: string;
  endDate?: string;
  /** Task-only legacy alias of `endDate`; used as an end fallback when present. */
  dueDate?: string;
  /** Bug-only ('' on a task) — drawn as its own chip beside the status. */
  severity?: BugSeverity | '';
  /** Team label keys, resolved against the item's own team (see `labelsFor`). */
  labelKeys?: string[];
  /** Everyone on the issue, primary first. */
  assignees?: IssueAssigneeDto[];
}

interface IssueTimelineViewProps {
  items: IssueTimelineItem[];
  /** Picks the status-colour source and the detail route (`/tasks` vs `/bugs`). */
  issueType: TeamIssueType;
  isLoading?: boolean;
  /** Overrides the per-team status lookup, and skips its authenticated `/teams`
   *  fetch — for a caller (e.g. a public board) that already has its one team's
   *  statuses in hand. */
  statusesFor?: (teamId: string | undefined, issueType: TeamIssueType) => TeamStatusConfig[];
  /** The same escape hatch for the label chips — supply it and no `/teams` fetch
   *  happens for them either. */
  labelsFor?: (teamId: string | undefined) => TaskLabelConfig[];
  /** …and for the team chip. */
  teamFor?: (teamId: string | undefined) => TeamChipTeam | undefined;
  /** Overrides what a row opens (e.g. the public board's read-only dialog) instead
   *  of this view's own peek drawer, which needs an account. */
  onOpenItem?: (item: IssueTimelineItem) => void;
}

/** The date that anchors a row's position — its start, else its end. */
function anchor(i: IssueTimelineItem): number {
  const s = toEpoch(i.startDate);
  return isEpoch(s) ? s : firstEpoch(i.endDate, i.dueDate);
}

/**
 * A schedule timeline for a team's issues (tasks or bugs): one row per issue,
 * drawn as a **bar** from its start to its end date, coloured by the issue's own
 * team status. An issue with only one of the two dates shows a **diamond** on
 * that date; an issue with neither is listed but not placed. A thin adapter over
 * the shared `<GanttChart>` — the same surface the roadmap timeline uses.
 *
 * Each row carries the **same chips the board card and the list row carry** —
 * ref, team, status, severity, labels, assignees — because a timeline you can't
 * identify a row in is just a picture of dates: you'd have to open every bar to
 * find whose it is, which team owns it, or whether it's blocked.
 *
 * Clicking a row **peeks** it in a drawer rather than navigating, for the reason
 * the roadmap timeline does: leaving the chart to read one issue and coming back
 * loses your place on the axis, and a timeline is about the rows *around* the one
 * you're reading. The drawer carries its own "open full page" link.
 */
export function IssueTimelineView({
  items,
  issueType,
  isLoading,
  statusesFor: statusesForOverride,
  labelsFor: labelsForOverride,
  teamFor: teamForOverride,
  onOpenItem,
}: IssueTimelineViewProps) {
  // Same hooks either way (rules of hooks) — `enabled` just skips their fetch
  // when the caller supplies its own lookup.
  const statusesForHook = useTeamStatusesLookup(!statusesForOverride);
  const labelsForHook = useTeamLabelsLookup(!labelsForOverride);
  const teamForHook = useTeamLookup(!teamForOverride);
  const statusesFor = statusesForOverride ?? statusesForHook;
  const labelsFor = labelsForOverride ?? labelsForHook;
  const teamFor = teamForOverride ?? teamForHook;
  const [peek, setPeek] = useState<IssuePeek | null>(null);

  // Name the team only on a board whose rows actually span teams — "All issues",
  // "Assigned to me", a roadmap's tasks. On a single team's board every chip
  // would say the same thing the page title already does, and the rail is narrow.
  const showTeam = new Set(items.map((i) => i.teamId).filter(Boolean)).size > 1;

  // One detail URL for both kinds — the ref names its own kind, so nothing here
  // branches on task vs bug to build a link.
  const open =
    onOpenItem ??
    ((issue: IssueTimelineItem) =>
      setPeek({ id: issue.id, issueType, href: `/issues/${issue.shortId || issue.id}` }));

  // Dated first (soonest at the top), undated last — a stable, useful order.
  const ordered = [...items].sort((a, b) => {
    const aa = anchor(a);
    const bb = anchor(b);
    if (isEpoch(aa) && isEpoch(bb)) return aa - bb;
    return isEpoch(aa) ? -1 : isEpoch(bb) ? 1 : 0;
  });

  const rows: GanttRow[] = ordered.map((issue) => {
    const start = toEpoch(issue.startDate);
    const end = firstEpoch(issue.endDate, issue.dueDate);
    const cfg = statusesFor(issue.teamId, issueType).find((c) => c.key === issue.status);
    const color = cfg?.color ?? 'hsl(var(--muted-foreground))';
    const statusLabel = cfg?.label ?? issue.status;

    const row: GanttRow = {
      id: issue.id,
      label: issue.title,
      dotColor: color,
      onClick: () => open(issue),
      // The row's identity, widest scope first: ref, team, state, labels, people.
      // Assignees only when there are any — an "Unassigned" pill on every row
      // would crowd out the labels in a rail this narrow, and an empty slot says
      // the same thing.
      meta: (
        <>
          {issue.shortId && (
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{issue.shortId}</span>
          )}
          {showTeam && <TeamChip team={teamFor(issue.teamId)} />}
          <GanttChip color={color}>{statusLabel}</GanttChip>
          {issue.severity && (
            <GanttChip color={BUG_SEVERITY_COLOR[issue.severity]} title={t('bugs.severity')}>
              {BUG_SEVERITY_LABEL[issue.severity]}
            </GanttChip>
          )}
          <LabelChips keys={issue.labelKeys} labels={labelsFor(issue.teamId)} max={2} />
          {issue.assignees && issue.assignees.length > 0 && (
            <AssigneeBadge
              assignees={issue.assignees}
              unassignedLabel={t('tasks.unassigned')}
              className="max-w-[160px] py-0 text-[11px] font-medium"
            />
          )}
        </>
      ),
    };

    if (isEpoch(start) && isEpoch(end)) {
      const range = `${formatDate(new Date(start))} – ${formatDate(new Date(end))}`;
      row.bar = { start, end, color, tooltip: `${issue.title} · ${range} · ${statusLabel}` };
    } else if (isEpoch(end)) {
      row.marker = { at: end, color, tooltip: `${issue.title} · ${formatDate(new Date(end))} · ${statusLabel}` };
    } else if (isEpoch(start)) {
      row.marker = { at: start, color, tooltip: `${issue.title} · ${formatDate(new Date(start))} · ${statusLabel}` };
    } else {
      row.emptyText = t('boards.timelineNoDates');
    }
    return row;
  });

  return (
    <>
      <GanttChart
        rows={rows}
        isLoading={isLoading}
        labelHeader={t('boards.timelineIssue')}
        empty={{ title: t('boards.timelineEmpty'), hint: t('boards.timelineEmptyHint') }}
        legend={
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-6 rounded-full bg-muted-foreground" aria-hidden />
              {t('boards.timelineLegendBar')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rotate-45 rounded-[2px] bg-muted-foreground" aria-hidden />
              {t('boards.timelineLegendMarker')}
            </span>
          </>
        }
      />
      {/* Never opened when the caller passed `onOpenItem` — a public board has no
          account to fetch a detail with, and opens its own dialog instead. */}
      <IssuePeekDrawer peek={peek} onClose={() => setPeek(null)} />
    </>
  );
}
