/**
 * Bug **stability** — is the app settling down, or still shaking?
 *
 * The board answers "what's open right now"; it can't answer "are we getting
 * better". This does, by slicing recent history into equal windows and counting
 * the bugs of the severities the caller picked (critical + high by default —
 * read as P0 + P1; there is no separate priority field, see `issue-diff.ts`) in
 * each one:
 *
 *   • opened(period)   = bugs whose `createdAt` falls in the window — the rate
 *                        new serious problems are still being found
 *   • openAtEnd(period)= bugs created on/before the window's last day and not
 *                        yet resolved by it — the standing debt
 *
 * Two series, because either alone lies. Falling `opened` with flat `openAtEnd`
 * means testing stopped, not that the app improved; falling `openAtEnd` with
 * flat `opened` means the team is only keeping pace with a still-broken build.
 * Both falling together is the shape people mean by "stabilising".
 *
 * Windows are built **backwards from the last day**, so the most recent one is
 * always full-length. A partial trailing window would show fewer bugs purely
 * because it is shorter, and read as improvement that never happened.
 *
 * Pure and date-only (UTC `YYYY-MM-DD`), like `cycle-burndown.ts` — the
 * repository hands over raw rows, every rule lives here and is unit-testable
 * without Mongo.
 */
import { addDays, isoWeekday, parseISODate, toISODate } from '@application/cycles/domain/cycle-dates';
import { BugSeverity } from './enums/issue.enums';

/** Period lengths the UI offers. Kept here so the DTO validates against the
 *  same list the chart draws. */
export const STABILITY_PERIOD_DAYS = [1, 3, 7, 14] as const;
export type StabilityPeriodDays = (typeof STABILITY_PERIOD_DAYS)[number];

/** How many windows to draw when the caller doesn't say. Enough to see a slope,
 *  few enough that the bars stay readable on a phone. */
export const DEFAULT_STABILITY_PERIODS = 8;

/** Upper bound on windows — past this the bars are hairlines and the query
 *  reaches back further than the data is meaningful. */
export const MAX_STABILITY_PERIODS = 24;

/**
 * Every severity the chart can count, **most serious first**.
 *
 * This is also the stacking order — critical sits on the baseline, low on top —
 * so a bar's most alarming part is the part anchored to the axis and stays
 * comparable between bars no matter which severities are ticked.
 */
export const STABILITY_SEVERITY_ORDER: BugSeverity[] = [
  BugSeverity.CRITICAL,
  BugSeverity.HIGH,
  BugSeverity.MEDIUM,
  BugSeverity.LOW,
];

/** What the chart counts when the caller doesn't say: the serious two, read as
 *  P0 + P1. Medium/low are noise for a "is it stabilising?" reading — they're
 *  offered, but they don't decide the verdict unless asked for. */
export const DEFAULT_STABILITY_SEVERITIES: BugSeverity[] = [
  BugSeverity.CRITICAL,
  BugSeverity.HIGH,
];

/** The projected bug fields the calculation needs — one row per serious bug. */
export interface StabilityIssueRow {
  createdAt: Date;
  /** When it became finished. Null on a still-open bug **and** on a row written
   *  before `resolvedAt` existed — {@link resolvedDay} tells the two apart. */
  resolvedAt: Date | null;
  /** Current status; the fallback that rescues a pre-`resolvedAt` row. */
  status: string;
  updatedAt: Date;
  severity: string;
}

/** One window on the x-axis. */
export interface StabilityPeriod {
  /** Inclusive first day, UTC `YYYY-MM-DD`. */
  start: string;
  /** Inclusive last day. */
  end: string;
  /** Calendar days the window spans — larger than `periodDays` when weekends
   *  are skipped, so the tooltip can say which dates a "3 working days" bar covers. */
  days: number;
  /** Critical bugs opened in the window (P0). */
  openedCritical: number;
  /** High bugs opened in the window (P1). */
  openedHigh: number;
  /** Medium bugs opened in the window. 0 unless medium is a counted severity. */
  openedMedium: number;
  /** Low bugs opened in the window. 0 unless low is a counted severity. */
  openedLow: number;
  /** The four above added up — the bar's height. */
  opened: number;
  /** Counted bugs resolved during the window — context for a falling backlog. */
  resolved: number;
  /** Counted bugs still open at the window's last day, however old. */
  openAtEnd: number;
}

/** What the two slopes add up to. Deliberately coarse: three words a product
 *  owner can act on, not a score to argue with. */
export type StabilityVerdict = 'improving' | 'steady' | 'worsening' | 'insufficient';

export interface StabilityResult {
  periodDays: number;
  skipWeekends: boolean;
  /** Which severities these numbers cover, echoed back so the chart draws a
   *  legend for what was actually counted rather than what it asked for. */
  severities: string[];
  /** Oldest → newest, so the chart draws left to right. */
  series: StabilityPeriod[];
  /** Counted bugs opened across the whole window. */
  totalOpened: number;
  /** Still open on the final day — the number the board would show today. */
  openNow: number;
  /**
   * Least-squares slope of `opened`, expressed as a fraction of the mean per
   * period: −0.2 means the open rate is shedding a fifth of its average each
   * window. Normalised so a team with 40 bugs a week and one with 4 read the same.
   */
  openedTrend: number;
  /** The same slope over `openAtEnd` — how the standing debt is moving. */
  openTrend: number;
  verdict: StabilityVerdict;
}

export interface BuildStabilityInput {
  /** Last day of the newest window, UTC `YYYY-MM-DD` (usually the viewer's today). */
  until: string;
  periodDays: number;
  periods: number;
  /** Size the windows in working days instead of calendar days. Weekend days
   *  still *belong* to the window that spans them — a Saturday bug is real. */
  skipWeekends: boolean;
  /** Severities to count. Rows of any other severity are dropped here as well as
   *  in the query — the caller picks the mix, and every number in the result
   *  (bars, backlog line, verdict) has to describe the same set of bugs. */
  severities: string[];
  rows: StabilityIssueRow[];
  /** Statuses that count as finished (`COMPLETED_STATUS_KEYS[bug]`). */
  completedKeys: string[];
}

/** Sat/Sun on the ISO scale (1 = Monday). */
function isWeekend(iso: string): boolean {
  return isoWeekday(iso) >= 6;
}

/**
 * The day a bug was resolved, or null while it's open.
 *
 * `resolvedAt` is authoritative, but rows written before that field existed
 * carry null even when closed (`backfill:issue-resolved-at` stamps them, and may
 * not have run on every workspace). Falling back to `updatedAt` for a row parked
 * in a done status keeps those bugs out of the backlog line — otherwise a
 * long-closed bug sits in `openAtEnd` forever and the chart never improves.
 */
function resolvedDay(row: StabilityIssueRow, completedKeys: string[]): string | null {
  if (row.resolvedAt) return toISODate(row.resolvedAt.getTime());
  if (completedKeys.includes(row.status)) return toISODate(row.updatedAt.getTime());
  return null;
}

/**
 * The windows, oldest → newest.
 *
 * Contiguous by construction: each window starts the day after the previous one
 * ends, so no bug falls between two bars. With `skipWeekends` the *quota* is
 * working days but the span stays calendar-continuous — a 3-working-day window
 * ending on Monday reaches back to Saturday and counts the weekend's bugs in it.
 */
export function buildStabilityWindows(
  until: string,
  periodDays: number,
  periods: number,
  skipWeekends: boolean,
): { start: string; end: string; days: number }[] {
  const out: { start: string; end: string; days: number }[] = [];
  let end = until;

  for (let p = 0; p < periods; p++) {
    let cursor = end;
    let counted = 0;
    let span = 0;
    let start = end;

    // Walk back day by day until the window holds `periodDays` qualifying days.
    // The guard is a belt-and-braces stop: with `skipWeekends` a window can only
    // ever be `periodDays` working days plus at most two weekend days per week,
    // but an unbounded `while` next to a date loop is how infinite loops ship.
    while (counted < periodDays && span < periodDays * 7 + 7) {
      if (!skipWeekends || !isWeekend(cursor)) {
        counted++;
        start = cursor;
      }
      span++;
      if (counted < periodDays) cursor = addDays(cursor, -1);
    }

    out.push({
      start,
      end,
      days: Math.round((parseISODate(end) - parseISODate(start)) / 86_400_000) + 1,
    });
    end = addDays(start, -1);
  }

  return out.reverse();
}

/**
 * Least-squares slope over `values` (x = 0,1,2…), normalised by the mean.
 *
 * Normalising is what makes the number comparable between a noisy team and a
 * quiet one. A mean of 0 (nothing happened all window) has no slope to speak of,
 * so it reads flat rather than dividing by zero.
 */
export function normalisedTrend(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (mean === 0) return 0;

  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - mean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den / mean;
}

/** Slope past which a direction is called rather than shrugged at: ~10% of the
 *  mean per period, which over 8 windows is a visible, sustained move. */
const TREND_BAND = 0.1;

/**
 * The verdict. Both series must agree in direction — the mixed cases (fewer new
 * bugs but a growing backlog, or vice versa) are exactly the ones that shouldn't
 * be called stable, so they land on `steady` and leave the reading to the chart.
 *
 * A window with almost nothing in it can't support a verdict at all: three bugs
 * across eight periods will produce a confident-looking slope out of noise.
 */
export function stabilityVerdict(
  openedTrend: number,
  openTrend: number,
  totalOpened: number,
  periods: number,
): StabilityVerdict {
  if (periods < 3 || totalOpened < periods) return 'insufficient';
  if (openedTrend <= -TREND_BAND && openTrend <= TREND_BAND) return 'improving';
  if (openedTrend >= TREND_BAND && openTrend >= -TREND_BAND) return 'worsening';
  if (openTrend >= TREND_BAND * 2) return 'worsening';
  return 'steady';
}

/** Roll the raw rows into the windows. */
export function buildStability(input: BuildStabilityInput): StabilityResult {
  const { until, periodDays, periods, skipWeekends, severities, rows, completedKeys } = input;
  const windows = buildStabilityWindows(until, periodDays, periods, skipWeekends);

  // The repository already filters, but the rule belongs here too: this is the
  // file that decides what "opened" and "still open" mean, and both have to mean
  // the same set of bugs whatever fed it.
  const counted = new Set(severities);

  // Pre-resolve each row to its two days once; the inner loop is O(rows × periods).
  const prepared = rows
    .filter((r) => counted.has(r.severity))
    .map((r) => ({
      created: toISODate(r.createdAt.getTime()),
      resolved: resolvedDay(r, completedKeys),
      severity: r.severity,
    }));

  const series: StabilityPeriod[] = windows.map((w) => {
    const opened: Record<string, number> = {
      [BugSeverity.CRITICAL]: 0,
      [BugSeverity.HIGH]: 0,
      [BugSeverity.MEDIUM]: 0,
      [BugSeverity.LOW]: 0,
    };
    let resolved = 0;
    let openAtEnd = 0;

    for (const r of prepared) {
      if (r.created >= w.start && r.created <= w.end) opened[r.severity]++;
      if (r.resolved && r.resolved >= w.start && r.resolved <= w.end) resolved++;
      // Standing debt: born on or before the last day, not yet buried by it.
      if (r.created <= w.end && (!r.resolved || r.resolved > w.end)) openAtEnd++;
    }

    return {
      ...w,
      openedCritical: opened[BugSeverity.CRITICAL],
      openedHigh: opened[BugSeverity.HIGH],
      openedMedium: opened[BugSeverity.MEDIUM],
      openedLow: opened[BugSeverity.LOW],
      opened:
        opened[BugSeverity.CRITICAL] +
        opened[BugSeverity.HIGH] +
        opened[BugSeverity.MEDIUM] +
        opened[BugSeverity.LOW],
      resolved,
      openAtEnd,
    };
  });

  const totalOpened = series.reduce((s, p) => s + p.opened, 0);
  const openedTrend = normalisedTrend(series.map((p) => p.opened));
  const openTrend = normalisedTrend(series.map((p) => p.openAtEnd));

  return {
    periodDays,
    skipWeekends,
    // Ordered, not as passed — the chart stacks in this order and a caller
    // sending `[low, critical]` must not flip the stack.
    severities: STABILITY_SEVERITY_ORDER.filter((s) => counted.has(s)),
    series,
    totalOpened,
    openNow: series.length ? series[series.length - 1].openAtEnd : 0,
    openedTrend,
    openTrend,
    verdict: stabilityVerdict(openedTrend, openTrend, totalOpened, series.length),
  };
}
