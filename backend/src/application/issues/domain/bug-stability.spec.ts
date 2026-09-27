import {
  buildStability,
  buildStabilityWindows,
  DEFAULT_STABILITY_SEVERITIES,
  normalisedTrend,
  stabilityVerdict,
  StabilityIssueRow,
} from './bug-stability';
import { BugSeverity, BugStatus } from './enums/issue.enums';

const COMPLETED = [BugStatus.RESOLVED, BugStatus.CLOSED];
const SERIOUS = DEFAULT_STABILITY_SEVERITIES;

/** 2026-09-07 is a Monday; 09-05/09-06 are the Saturday/Sunday before it. */
const MON = '2026-09-07';

function row(
  partial: Omit<Partial<StabilityIssueRow>, 'createdAt'> & { createdAt: string },
): StabilityIssueRow {
  return {
    createdAt: new Date(`${partial.createdAt}T10:00:00Z`),
    resolvedAt: partial.resolvedAt ?? null,
    status: partial.status ?? BugStatus.OPEN,
    updatedAt: partial.updatedAt ?? new Date(`${partial.createdAt}T10:00:00Z`),
    severity: partial.severity ?? BugSeverity.HIGH,
  };
}

describe('buildStabilityWindows', () => {
  it('walks back in calendar days, oldest first, ending on the requested day', () => {
    const w = buildStabilityWindows(MON, 3, 3, false);
    expect(w).toEqual([
      { start: '2026-08-30', end: '2026-09-01', days: 3 },
      { start: '2026-09-02', end: '2026-09-04', days: 3 },
      { start: '2026-09-05', end: MON, days: 3 },
    ]);
  });

  it('is contiguous — no day falls between two windows', () => {
    const w = buildStabilityWindows(MON, 7, 4, true);
    for (let i = 1; i < w.length; i++) {
      const prevEndNext = new Date(`${w[i - 1].end}T00:00:00Z`);
      prevEndNext.setUTCDate(prevEndNext.getUTCDate() + 1);
      expect(w[i].start).toBe(prevEndNext.toISOString().slice(0, 10));
    }
  });

  it('sizes a window in working days but still spans the weekend it covers', () => {
    // 3 working days back from Monday = Thu, Fri, Mon — so the span reaches Thu
    // and swallows Sat + Sun, which is how a weekend bug still gets counted.
    const [latest] = buildStabilityWindows(MON, 3, 1, true);
    expect(latest).toEqual({ start: '2026-09-03', end: MON, days: 5 });
  });

  it('keeps the newest window full-length rather than trailing a partial one', () => {
    const w = buildStabilityWindows(MON, 7, 2, false);
    expect(w[w.length - 1]).toEqual({ start: '2026-09-01', end: MON, days: 7 });
  });
});

describe('normalisedTrend', () => {
  it('is negative when the series falls, and scale-free', () => {
    const small = normalisedTrend([16, 14, 11, 8, 5]);
    const big = normalisedTrend([160, 140, 110, 80, 50]);
    expect(small).toBeLessThan(0);
    expect(small).toBeCloseTo(big, 10);
  });

  it('is 0 for a flat series and for an all-zero one', () => {
    expect(normalisedTrend([4, 4, 4, 4])).toBe(0);
    expect(normalisedTrend([0, 0, 0])).toBe(0);
  });
});

describe('stabilityVerdict', () => {
  it('refuses to call it on too little data', () => {
    expect(stabilityVerdict(-0.9, -0.9, 2, 8)).toBe('insufficient');
    expect(stabilityVerdict(-0.9, -0.9, 40, 2)).toBe('insufficient');
  });

  it('calls improving only when the backlog is not growing behind it', () => {
    expect(stabilityVerdict(-0.3, -0.2, 40, 8)).toBe('improving');
    // Fewer new bugs, but the debt is piling up fast — that is not stabilising.
    expect(stabilityVerdict(-0.3, 0.4, 40, 8)).toBe('worsening');
  });

  it('shrugs at a flat run', () => {
    expect(stabilityVerdict(0.02, -0.01, 40, 8)).toBe('steady');
  });
});

describe('buildStability', () => {
  it('splits opened bugs by severity into the window they landed in', () => {
    const r = buildStability({
      until: MON,
      periodDays: 3,
      periods: 2,
      skipWeekends: false,
      severities: SERIOUS,
      completedKeys: COMPLETED,
      rows: [
        row({ createdAt: '2026-09-02', severity: BugSeverity.CRITICAL }),
        row({ createdAt: '2026-09-03', severity: BugSeverity.HIGH }),
        row({ createdAt: '2026-09-06', severity: BugSeverity.CRITICAL }),
      ],
    });
    expect(r.series.map((p) => [p.start, p.openedCritical, p.openedHigh])).toEqual([
      ['2026-09-02', 1, 1],
      ['2026-09-05', 1, 0],
    ]);
    expect(r.totalOpened).toBe(3);
  });

  it('ignores a severity that was not asked for, in every series', () => {
    const rows = [
      row({ createdAt: '2026-09-06', severity: BugSeverity.CRITICAL }),
      row({ createdAt: '2026-09-06', severity: BugSeverity.MEDIUM }),
      row({ createdAt: '2026-09-06', severity: BugSeverity.LOW }),
    ];
    const base = {
      until: MON,
      periodDays: 3,
      periods: 1,
      skipWeekends: false,
      completedKeys: COMPLETED,
      rows,
    };

    const serious = buildStability({ ...base, severities: SERIOUS });
    expect(serious.totalOpened).toBe(1);
    // The backlog line has to describe the same bugs as the bars, or the two
    // series can't be read against each other.
    expect(serious.openNow).toBe(1);
    expect(serious.series[0].openedMedium).toBe(0);

    const all = buildStability({
      ...base,
      severities: [BugSeverity.LOW, BugSeverity.CRITICAL, BugSeverity.MEDIUM],
    });
    expect(all.totalOpened).toBe(3);
    expect(all.openNow).toBe(3);
    expect([all.series[0].openedMedium, all.series[0].openedLow]).toEqual([1, 1]);
    // Echoed back in stacking order, not the order the caller happened to send.
    expect(all.severities).toEqual([BugSeverity.CRITICAL, BugSeverity.MEDIUM, BugSeverity.LOW]);
  });

  it('counts a bug as open until the day it was resolved, however old it is', () => {
    const r = buildStability({
      until: MON,
      periodDays: 3,
      periods: 2,
      skipWeekends: false,
      severities: SERIOUS,
      completedKeys: COMPLETED,
      rows: [
        // Opened long before the window; closed inside the newest one.
        row({
          createdAt: '2026-06-01',
          status: BugStatus.CLOSED,
          resolvedAt: new Date('2026-09-05T09:00:00Z'),
        }),
      ],
    });
    expect(r.series.map((p) => p.openAtEnd)).toEqual([1, 0]);
    expect(r.series.map((p) => p.resolved)).toEqual([0, 1]);
    expect(r.openNow).toBe(0);
    // It was never *opened* in the window, so it adds nothing to the bars.
    expect(r.totalOpened).toBe(0);
  });

  it('falls back to updatedAt for a done bug written before resolvedAt existed', () => {
    const r = buildStability({
      until: MON,
      periodDays: 3,
      periods: 1,
      skipWeekends: false,
      severities: SERIOUS,
      completedKeys: COMPLETED,
      rows: [
        row({
          createdAt: '2026-05-01',
          status: BugStatus.RESOLVED,
          resolvedAt: null,
          updatedAt: new Date('2026-05-09T09:00:00Z'),
        }),
      ],
    });
    // Without the fallback this row would sit in `openAtEnd` for ever.
    expect(r.openNow).toBe(0);
  });

  it('reads the sketch shape as improving', () => {
    // 16 → 14 → 11 → 8 → 5 opened, backlog draining behind it.
    const counts = [16, 14, 11, 8, 5];
    const rows: StabilityIssueRow[] = [];
    counts.forEach((n, i) => {
      const day = `2026-09-0${i + 1}`;
      for (let k = 0; k < n; k++) {
        rows.push(
          row({
            createdAt: day,
            status: BugStatus.CLOSED,
            resolvedAt: new Date(`2026-09-0${i + 1}T18:00:00Z`),
          }),
        );
      }
    });
    const r = buildStability({
      until: '2026-09-05',
      periodDays: 1,
      periods: 5,
      skipWeekends: false,
      severities: SERIOUS,
      completedKeys: COMPLETED,
      rows,
    });
    expect(r.series.map((p) => p.opened)).toEqual(counts);
    expect(r.openedTrend).toBeLessThan(0);
    expect(r.verdict).toBe('improving');
  });
});
