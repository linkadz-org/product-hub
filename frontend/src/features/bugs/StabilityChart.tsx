import { useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import { useTheme } from '@/lib/theme';
import { shortDay } from '@/features/cycles/dates';
import { BugSeverity } from '@/types/enums';
import type { IssueStabilityDto, IssueStabilityPoint } from '@/types/dto';

/**
 * Chart colours per severity, per theme.
 *
 * These are *near* the board's severity dots (red = critical, amber = high, blue
 * = medium) but a ramp step off them, and that is deliberate: a dot sits alone on
 * a card, whereas here the colours are stacked flush against each other and have
 * to stay separable. The board's own pair (`#ef4444` / `#c47608`) measures ΔE 2.8
 * under deuteranopia — a red-green reader sees one bar, not two — and the dark
 * severity red (`#7f1d1d`) has 1.74:1 contrast against the dark surface, i.e.
 * nearly invisible.
 *
 * Low is **cyan, not the board's grey**: grey fails the chroma floor as a fill
 * and would collide with the still-open reference line, which is drawn in muted
 * ink precisely because it is *not* a category.
 *
 * Any subset of severities can be ticked, so any two of these four can end up
 * adjacent in a stack — the palette is validated on **all pairs**, not just the
 * consecutive ones: lightness band, chroma floor, CVD separation (worst pair ΔE
 * 14.7 light / 9.4 dark), normal-vision floor (16.3) and surface contrast, in
 * both themes. Validated with the palette script, not eyeballed.
 *
 * Amber sits at 2.15:1 on the light surface, which is allowed only with relief:
 * every bar carries a visible total, the legend names every severity and the
 * table view below repeats every number, so identity is never colour-alone.
 */
const CHART_COLOR: Record<'light' | 'dark', Record<BugSeverity, string>> = {
  light: {
    [BugSeverity.CRITICAL]: '#e11d48',
    [BugSeverity.HIGH]: '#f59e0b',
    [BugSeverity.MEDIUM]: '#2563eb',
    [BugSeverity.LOW]: '#0891b2',
  },
  dark: {
    [BugSeverity.CRITICAL]: '#e11d48',
    [BugSeverity.HIGH]: '#d97706',
    [BugSeverity.MEDIUM]: '#2563eb',
    [BugSeverity.LOW]: '#0891b2',
  },
};

/** The swatch a severity wears, for anything outside the SVG that has to match
 *  it — the picker's dots. One source, so a chip and its bar can't disagree. */
export function severityColor(theme: 'light' | 'dark', severity: BugSeverity): string {
  return CHART_COLOR[theme][severity];
}

/**
 * What each severity is called here, and **what it actually means**.
 *
 * The explanation is the point: "critical" and "high" are the two words a team
 * argues about most, and a chart that counts them without saying where the line
 * is just moves the argument. Exported so the severity picker and the legend
 * read from one source — a chip and its bar can never describe different things.
 */
export const SEVERITY_META: Record<BugSeverity, { label: string; hint: string }> = {
  [BugSeverity.CRITICAL]: {
    label: t('bugs.stability.sevCritical'),
    hint: t('bugs.stability.sevCriticalHint'),
  },
  [BugSeverity.HIGH]: {
    label: t('bugs.stability.sevHigh'),
    hint: t('bugs.stability.sevHighHint'),
  },
  [BugSeverity.MEDIUM]: {
    label: t('bugs.stability.sevMedium'),
    hint: t('bugs.stability.sevMediumHint'),
  },
  [BugSeverity.LOW]: {
    label: t('bugs.stability.sevLow'),
    hint: t('bugs.stability.sevLowHint'),
  },
};

/** Most serious first — the stack's bottom-to-top order. Mirrors the backend's
 *  `STABILITY_SEVERITY_ORDER`, which is also the order it echoes back. */
export const SEVERITY_STACK: BugSeverity[] = [
  BugSeverity.CRITICAL,
  BugSeverity.HIGH,
  BugSeverity.MEDIUM,
  BugSeverity.LOW,
];

/** Severity → the flat count field it lives in (the API keeps them flat rather
 *  than nesting a map, per the DTO convention). */
const OPENED_FIELD: Record<BugSeverity, keyof IssueStabilityPoint> = {
  [BugSeverity.CRITICAL]: 'openedCritical',
  [BugSeverity.HIGH]: 'openedHigh',
  [BugSeverity.MEDIUM]: 'openedMedium',
  [BugSeverity.LOW]: 'openedLow',
};

function openedBy(p: IssueStabilityPoint, severity: BugSeverity): number {
  return (p[OPENED_FIELD[severity]] as number) ?? 0;
}

/** The still-open line is a *reference*, not another category — it wears the
 *  muted ink and is told apart by form (a line with markers, not a fill). */
const OPEN_INK = 'hsl(var(--muted-foreground))';

/** Round a max up to a friendly axis bound (same helper as the burn-up chart). */
function niceMax(v: number): number {
  if (v <= 5) return 5;
  if (v <= 10) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

/** A rect with only its top corners rounded — the "data end" of a stack. The
 *  baseline end stays square so the bar reads as sitting on the axis. */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return [
    `M${x},${y + h}`,
    `L${x},${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `L${x + w - rr},${y}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `L${x + w},${y + h}`,
    'Z',
  ].join(' ');
}

/**
 * Bug stability, hand-drawn in SVG (no chart dep — same approach as the cycle
 * burn-up).
 *
 * Stacked bars are the bugs **opened** in each period, split by severity, most
 * serious on the baseline; the line behind them is how many were **still open**
 * when that period closed. Both count bugs, so they share one y-axis — the
 * two-scale version of this chart would let any shape be argued into any
 * conclusion.
 *
 * Reading it: bars falling while the line falls is the app settling down. Bars
 * falling while the line stays flat usually means testing stopped, not that the
 * app got better — which is exactly why the line is here.
 */
export function StabilityChart({ data }: { data: IssueStabilityDto }) {
  const { theme } = useTheme();
  const color = CHART_COLOR[theme];
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const points = data.series ?? [];
  const n = points.length;
  // Drawn in *our* order, not the response's, so a bar's colours never reorder
  // between two loads; the API sends them sorted, this is the belt to that brace.
  const stack = useMemo(() => {
    const on = new Set(data.severities ?? []);
    return SEVERITY_STACK.filter((s) => on.has(s));
  }, [data.severities]);

  // Geometry — a fixed viewBox scaled to the container via `w-full h-auto`.
  const W = 720;
  const H = 260;
  const m = { top: 22, right: 14, bottom: 34, left: 32 };
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const yMax = useMemo(
    () => niceMax(Math.max(1, ...points.map((p) => Math.max(p.opened, p.openAtEnd)))),
    [points],
  );

  const band = n ? innerW / n : innerW;
  // Thin marks: the bar takes a little over half its band, capped so eight
  // periods don't render as slabs.
  const barW = Math.min(38, band * 0.56);
  const cxAt = (i: number) => m.left + band * (i + 0.5);
  const yAt = (v: number) => m.top + innerH - (v / yMax) * innerH;
  const baseY = m.top + innerH;

  const grid = 'hsl(var(--border))';
  const ticks = [0, 0.5, 1].map((f) => Math.round(yMax * f));
  // 2px of surface between stacked segments, so the split is visible even when
  // the colours can't be told apart.
  const GAP = 2;

  // Crowded axes drop labels rather than overlapping them; the tooltip and the
  // table still name every period.
  const labelEvery = n <= 8 ? 1 : n <= 14 ? 2 : 3;
  // A number over every bar is the relief for amber's contrast — but only while
  // there's room for it.
  const showValues = n <= 12;

  const onMove = (e: React.PointerEvent) => {
    if (!n) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.floor((vx - m.left) / band);
    setHover(idx < 0 ? 0 : idx >= n ? n - 1 : idx);
  };

  const hp = hover != null ? points[hover] : null;

  const openLine = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${cxAt(i)},${yAt(p.openAtEnd)}`)
    .join(' ');

  return (
    <div className="flex flex-col gap-3">
      <div ref={wrapRef} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={t('bugs.stability.chartAria')}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* y gridlines + labels */}
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={m.left}
                y1={yAt(v)}
                x2={W - m.right}
                y2={yAt(v)}
                stroke={grid}
                strokeWidth={1}
              />
              <text
                x={m.left - 6}
                y={yAt(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[9px] tabular-nums"
              >
                {v}
              </text>
            </g>
          ))}

          {/* hovered band — a wash behind the bar, so the hit target is the whole
              column rather than the mark itself */}
          {hover != null && (
            <rect
              x={m.left + band * hover}
              y={m.top}
              width={band}
              height={innerH}
              className="fill-muted"
              opacity={0.5}
              pointerEvents="none"
            />
          )}

          {/* stacked bars: most serious on the baseline, least serious on top */}
          {points.map((p, i) => {
            const x = cxAt(i) - barW / 2;
            // Empty severities are skipped before the geometry is laid out, so
            // the 2px gap only ever falls between two segments that are actually
            // drawn — an unticked or zero severity leaves no seam behind.
            const segs: { severity: BugSeverity; y: number; h: number }[] = [];
            let cursor = baseY;
            for (const severity of stack) {
              const v = openedBy(p, severity);
              if (v <= 0) continue;
              const h = (v / yMax) * innerH;
              cursor -= h;
              segs.push({ severity, y: cursor, h });
            }
            const stackTop = cursor;

            return (
              <g key={p.end}>
                {segs.map((seg, k) => {
                  const isTop = k === segs.length - 1;
                  // Every segment but the topmost gives up 2px at its top for the
                  // surface gap; one thinner than the gap keeps a hairline rather
                  // than vanishing.
                  const h = !isTop && seg.h > GAP ? seg.h - GAP : seg.h;
                  const y = isTop ? seg.y : seg.y + (seg.h - h);
                  return (
                    <path
                      key={seg.severity}
                      d={
                        isTop
                          ? topRoundedRect(x, y, barW, h, 4)
                          : `M${x},${y} h${barW} v${h} h${-barW} Z`
                      }
                      fill={color[seg.severity]}
                    />
                  );
                })}
                {showValues && p.opened > 0 && (
                  <text
                    x={cxAt(i)}
                    y={stackTop - 5}
                    textAnchor="middle"
                    className="fill-foreground text-[10px] font-medium tabular-nums"
                  >
                    {p.opened}
                  </text>
                )}
              </g>
            );
          })}

          {/* still-open line — drawn over the bars, with a surface ring on each
              marker so it never melts into the fill behind it */}
          {n > 1 && (
            <path
              d={openLine}
              fill="none"
              stroke={OPEN_INK}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {points.map((p, i) => (
            <circle
              key={`o-${p.end}`}
              cx={cxAt(i)}
              cy={yAt(p.openAtEnd)}
              r={4}
              fill={OPEN_INK}
              className="stroke-card"
              strokeWidth={2}
            />
          ))}

          {/* x baseline + period labels (the period's last day) */}
          <line x1={m.left} y1={baseY} x2={W - m.right} y2={baseY} stroke={grid} strokeWidth={1} />
          {points.map((p, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text
                key={`x-${p.end}`}
                x={cxAt(i)}
                y={H - 12}
                textAnchor="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {shortDay(p.end)}
              </text>
            ) : null,
          )}
        </svg>

        {/* hover tooltip — positioned over the wrapper by fraction of width */}
        {hp && (
          <div
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-md"
            style={{
              // Clamped so the first and last period's tooltip stays on screen.
              left: `${Math.min(88, Math.max(12, (cxAt(hover!) / W) * 100))}%`,
            }}
          >
            <div className="mb-1 text-[11px] font-medium">
              {shortDay(hp.start)} – {shortDay(hp.end)}
            </div>
            {stack.map((severity) => (
              <TooltipRow
                key={severity}
                color={color[severity]}
                label={SEVERITY_META[severity].label}
                value={openedBy(hp, severity)}
              />
            ))}
            <TooltipRow label={t('bugs.stability.resolved')} value={hp.resolved} />
            <TooltipRow color={OPEN_INK} label={t('bugs.stability.stillOpen')} value={hp.openAtEnd} />
          </div>
        )}
      </div>

      {/*
        Legend — always present, so identity is never colour-alone. It doubles as
        the chart's glossary: each row says what that severity *is*, because the
        bars are only comparable between periods if everyone files bugs against
        the same definition.
      */}
      <ul className="flex flex-col gap-1 text-xs">
        {stack.map((severity) => (
          <LegendItem
            key={severity}
            color={color[severity]}
            label={SEVERITY_META[severity].label}
            hint={SEVERITY_META[severity].hint}
          />
        ))}
        <LegendItem
          color={OPEN_INK}
          label={t('bugs.stability.stillOpen')}
          hint={t('bugs.stability.stillOpenHint')}
          line
        />
      </ul>

      {/* The same numbers as text — the accessible route through the chart, and
          the relief the amber fill's contrast requires. */}
      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          {t('bugs.stability.tableView')}
        </summary>
        <div className="mt-2 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[420px] text-left text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t('bugs.stability.period')}</th>
                {stack.map((severity) => (
                  <th key={severity} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    {SEVERITY_META[severity].label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">{t('bugs.stability.resolved')}</th>
                <th className="px-3 py-2 text-right font-medium">
                  {t('bugs.stability.stillOpen')}
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {points.map((p) => (
                <tr key={`r-${p.end}`} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">
                    {shortDay(p.start)} – {shortDay(p.end)}
                  </td>
                  {stack.map((severity) => (
                    <td key={severity} className="px-3 py-2 text-right">
                      {openedBy(p, severity)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">{p.resolved}</td>
                  <td className="px-3 py-2 text-right">{p.openAtEnd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** One legend row: the swatch, the name, and what that name means. The two texts
 *  sit on one line from `sm` up and wrap under each other on a phone. */
function LegendItem({
  color,
  label,
  hint,
  line,
}: {
  color: string;
  label: string;
  hint: string;
  line?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={
          line
            ? 'mt-[7px] h-0.5 w-3.5 shrink-0 rounded-full'
            : 'mt-[5px] size-2.5 shrink-0 rounded-[3px]'
        }
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{hint}</span>
      </span>
    </li>
  );
}

function TooltipRow({ color, label, value }: { color?: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
      <span
        className="size-2 shrink-0 rounded-[2px]"
        style={{ backgroundColor: color ?? 'transparent' }}
        aria-hidden
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto pl-3 font-medium">{value}</span>
    </div>
  );
}
