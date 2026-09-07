import { useState } from 'react';
import { Badge, Checkbox, Select, Skeleton } from '@/components/ui';
import { t } from '@/i18n';
import { todayIso } from '@/features/cycles/dates';
import { useTheme } from '@/lib/theme';
import { BugSeverity } from '@/types/enums';
import { useBugStability } from './api';
import { SEVERITY_META, SEVERITY_STACK, severityColor, StabilityChart } from './StabilityChart';
import type { IssueStabilityDto } from '@/types/dto';

/** Period lengths offered. Mirrors the backend's `STABILITY_PERIOD_DAYS` — a
 *  value outside this set is rejected there, so the two must stay in step. */
const PERIOD_DAYS = [1, 3, 7, 14];

/**
 * How many periods to draw. Fixed, not a control.
 *
 * It used to be a picker, and it earned nothing: eight is enough to see a slope
 * at every period length the chart offers, and *how far back* is already what
 * the period-length control changes (8 × 14 days is most of a quarter). A second
 * knob that stretches the same window just gave two ways to ask one question.
 */
const STABILITY_PERIODS = 8;

const DEFAULTS = {
  periodDays: 7,
  skipWeekends: false,
  /** The two that decide whether a build is shippable. Medium and low are
   *  available, but counting them by default would bury the signal in noise. */
  severities: [BugSeverity.CRITICAL, BugSeverity.HIGH],
};

/** Verdict → how it's badged and what it actually means. Kept together so the
 *  colour and the sentence can never disagree. */
const VERDICT: Record<
  IssueStabilityDto['verdict'],
  { variant: 'success' | 'warning' | 'destructive' | 'muted'; label: string; hint: string }
> = {
  improving: {
    variant: 'success',
    label: t('bugs.stability.verdictImproving'),
    hint: t('bugs.stability.verdictImprovingHint'),
  },
  steady: {
    variant: 'muted',
    label: t('bugs.stability.verdictSteady'),
    hint: t('bugs.stability.verdictSteadyHint'),
  },
  worsening: {
    variant: 'destructive',
    label: t('bugs.stability.verdictWorsening'),
    hint: t('bugs.stability.verdictWorseningHint'),
  },
  insufficient: {
    variant: 'muted',
    label: t('bugs.stability.verdictInsufficient'),
    hint: t('bugs.stability.verdictInsufficientHint'),
  },
};

/** A normalised slope (change per period ÷ the mean) as a signed percentage. */
function trendLabel(trend: number): string {
  const pct = Math.round(trend * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/**
 * The QC board's **Stability** view: are bugs arriving more slowly than before,
 * and is the pile of unfixed ones shrinking?
 *
 * The config here is the chart's own — which severities to count, how long a
 * period is, and whether a period is counted in working days — so it lives
 * beside the chart rather than in the board toolbar, which is reserved for
 * controls that *narrow a list*. Nothing here narrows anything; the whole board
 * is the sample, and the severity picker changes what is being measured rather
 * than hiding rows from a list.
 */
export function StabilityView({ teamId, projectId }: { teamId?: string; projectId?: string }) {
  const { theme } = useTheme();
  const [periodDays, setPeriodDays] = useState(DEFAULTS.periodDays);
  const [skipWeekends, setSkipWeekends] = useState(DEFAULTS.skipWeekends);
  const [severities, setSeverities] = useState<BugSeverity[]>(DEFAULTS.severities);

  /** Toggle one severity, keeping the canonical order so the query key (and the
   *  cache entry behind it) doesn't fork on click order alone. The last ticked
   *  one can't be removed — an empty chart isn't a reading, it's a blank. */
  const toggleSeverity = (severity: BugSeverity, on: boolean) => {
    setSeverities((prev) => {
      const next = on ? [...prev, severity] : prev.filter((s) => s !== severity);
      return next.length ? SEVERITY_STACK.filter((s) => next.includes(s)) : prev;
    });
  };

  const { data, isLoading, isError } = useBugStability({
    teamId,
    projectId,
    periodDays,
    periods: STABILITY_PERIODS,
    severities,
    skipWeekends,
    // The viewer's own today, so the last period ends on the day they're
    // looking at rather than the server's UTC one.
    until: todayIso(),
  });

  const verdict = data ? VERDICT[data.verdict] : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Config row — stacks on mobile, one line from `sm` up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <label className="flex items-center gap-2 text-sm">
          <span className="shrink-0 text-muted-foreground">{t('bugs.stability.periodLength')}</span>
          <Select
            className="w-[130px]"
            value={String(periodDays)}
            onValueChange={(v) => setPeriodDays(Number(v))}
            aria-label={t('bugs.stability.periodLength')}
            options={PERIOD_DAYS.map((d) => ({
              value: String(d),
              label: `${d} ${d === 1 ? t('bugs.stability.day') : t('bugs.stability.days')}`,
            }))}
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox
            checked={skipWeekends}
            onCheckedChange={(v) => setSkipWeekends(v === true)}
          />
          <span>{t('bugs.stability.workingDays')}</span>
        </label>
        {/* Says what the checkbox actually does — "skip weekends" reads as if
            weekend bugs are thrown away, and they aren't. */}
        <span className="text-xs text-muted-foreground sm:ml-auto">
          {skipWeekends
            ? t('bugs.stability.workingDaysOnHint')
            : t('bugs.stability.workingDaysOffHint')}
        </span>
      </div>

      {/*
        Which severities the bars count. Its own row rather than another control
        squeezed in above: this one changes *what is being measured*, not how the
        same measurement is sliced, and it's the choice most worth noticing —
        adding P2/P3 will make a settling chart look busier without the build
        being any worse. Each option carries its definition in the legend below;
        the dot is the colour that severity wears in the stack.
      */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
        <span className="shrink-0 text-sm text-muted-foreground">
          {t('bugs.stability.counting')}
        </span>
        {SEVERITY_STACK.map((severity) => {
          const checked = severities.includes(severity);
          // The last one standing is disabled rather than silently refusing the
          // click — a control that ignores you reads as broken.
          const locked = checked && severities.length === 1;
          return (
            <label
              key={severity}
              className={`flex items-center gap-2 text-sm ${locked ? '' : 'cursor-pointer'}`}
              title={locked ? t('bugs.stability.countingHint') : SEVERITY_META[severity].hint}
            >
              <Checkbox
                checked={checked}
                disabled={locked}
                onCheckedChange={(v) => toggleSeverity(severity, v === true)}
              />
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ backgroundColor: severityColor(theme, severity) }}
                aria-hidden
              />
              <span>{SEVERITY_META[severity].label}</span>
            </label>
          );
        })}
      </div>

      {isLoading ? (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-4 h-[220px] w-full" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground">{t('bugs.stability.error')}</p>
        </div>
      ) : data.totalOpened === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground">{t('bugs.stability.empty')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('bugs.stability.emptyHint')}</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-5">
          {/* Headline: the one number that answers "how bad is it right now",
              then the verdict and the two trends behind it. */}
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tabular-nums">{data.openNow}</span>
                <span className="text-sm text-muted-foreground">
                  {t('bugs.stability.openNow')}
                </span>
              </div>
              {verdict && (
                <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{verdict.hint}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {verdict && <Badge variant={verdict.variant}>{verdict.label}</Badge>}
              {data.verdict !== 'insufficient' && (
                <>
                  <TrendChip
                    label={t('bugs.stability.trendOpened')}
                    value={trendLabel(data.openedTrend)}
                  />
                  <TrendChip
                    label={t('bugs.stability.trendOpen')}
                    value={trendLabel(data.openTrend)}
                  />
                </>
              )}
            </div>
          </div>

          <StabilityChart data={data} />
        </div>
      )}
    </div>
  );
}

/** A trend read-out. Deliberately not colour-coded: down is good for one of
 *  these and the verdict badge beside them already carries the judgement. */
function TrendChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
      {label} <span className="font-medium tabular-nums text-foreground">{value}</span>
    </span>
  );
}
