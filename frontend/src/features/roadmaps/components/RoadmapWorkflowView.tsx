import { daysBetween, daysSince, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import type { RoadmapItem } from '@/types/dto';
import { RoadmapTimingSummary } from './RoadmapTimingSummary';
import { SprintChip } from './RoadmapSprintControls';
import type { RoadmapSprint } from '../useRoadmapSprints';

const days = (n: number) => t('board.ageDays').replace('{n}', String(n));

/** A finished duration, e.g. "10d" / "<1d" — dash when an endpoint is missing. */
const dur = (from?: string, to?: string) =>
  from && to ? (daysBetween(from, to) === 0 ? t('roadmaps.underDay') : days(daysBetween(from, to))) : '—';

interface Row {
  id: string;
  title: string;
  requested: string;
  started: string;
  completed: string;
  lead: string;
  /** **Cycle *time*** (started → completed), not a sprint — hence the separate
   *  "Sprint" column, which is the one that names a window. */
  cycle: string;
}

/** Which sprints an item's tasks ran in — the sprint column is drawn only when
 *  the caller can answer this (the public roadmap can't). */
type SprintsForItem = (itemId: string) => RoadmapSprint[];

/**
 * The Workflow view — a roadmap's lead & cycle time analytics gathered in one
 * place: the average summary (with its month-over-month trend and explainer) up
 * top, then a per-item breakdown of completed work, and anything still in flight
 * with its clock running.
 */
export function RoadmapWorkflowView({
  items,
  sprintsForItem,
}: {
  items: RoadmapItem[];
  sprintsForItem?: SprintsForItem;
}) {
  // Newest completion first — the most recent throughput reads at the top.
  const completed = items
    .filter((i) => i.completedAt)
    .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1));
  // Started but not done — show the lead/cycle accrued so far.
  const inFlight = items
    .filter((i) => i.startedAt && !i.completedAt)
    .sort((a, b) => (a.startedAt! < b.startedAt! ? 1 : -1));

  return (
    <div className="flex flex-col gap-6">
      <RoadmapTimingSummary items={items} variant="bar" />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-foreground">{t('roadmaps.completedItems')}</h2>
        {completed.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t('roadmaps.noCompleted')}
          </p>
        ) : (
          <TimingTable
            sprintsForItem={sprintsForItem}
            rows={completed.map((i) => ({
              id: i.id,
              title: i.title,
              requested: i.createdAt ? formatDate(i.createdAt) : '—',
              started: i.startedAt ? formatDate(i.startedAt) : '—',
              completed: formatDate(i.completedAt!),
              lead: dur(i.createdAt, i.completedAt),
              cycle: dur(i.startedAt, i.completedAt),
            }))}
          />
        )}
      </section>

      {inFlight.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-foreground">{t('roadmaps.inFlight')}</h2>
          <TimingTable
            sprintsForItem={sprintsForItem}
            rows={inFlight.map((i) => ({
              id: i.id,
              title: i.title,
              requested: i.createdAt ? formatDate(i.createdAt) : '—',
              started: formatDate(i.startedAt!),
              completed: '—',
              // Running so far — measured to now rather than to a completion.
              lead: i.createdAt ? days(daysSince(i.createdAt)) : '—',
              cycle: days(daysSince(i.startedAt!)),
            }))}
          />
        </section>
      )}
    </div>
  );
}

/** Item · Sprint · Requested · Started · Completed · Lead · Cycle. Scrolls
 *  sideways on narrow screens rather than squashing the columns. */
function TimingTable({ rows, sprintsForItem }: { rows: Row[]; sprintsForItem?: SprintsForItem }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className={cn('w-full text-sm', sprintsForItem ? 'min-w-[680px]' : 'min-w-[560px]')}>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-2 font-medium">{t('roadmaps.item')}</th>
            {/* Deliberately beside "Cycle" (which is cycle *time*) — the label is
                "Sprint" precisely so the two can sit in one table without
                anyone reading them as the same thing. */}
            {sprintsForItem && <th className="px-4 py-2 font-medium">{t('sprints.filterLabel')}</th>}
            <th className="px-4 py-2 font-medium">{t('roadmaps.requested')}</th>
            <th className="px-4 py-2 font-medium">{t('roadmaps.started')}</th>
            <th className="px-4 py-2 font-medium">{t('roadmaps.completed')}</th>
            <th className="px-4 py-2 text-right font-medium">{t('roadmaps.leadTime')}</th>
            <th className="px-4 py-2 text-right font-medium">{t('roadmaps.cycleTime')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-accent/40">
              <td className="max-w-[240px] truncate px-4 py-2 font-medium text-foreground" title={r.title}>
                {r.title}
              </td>
              {sprintsForItem && (
                <td className="px-4 py-2">
                  <SprintChip sprints={sprintsForItem(r.id)} />
                  {sprintsForItem(r.id).length === 0 && (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              )}
              <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{r.requested}</td>
              <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{r.started}</td>
              <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{r.completed}</td>
              <td className="px-4 py-2 text-right font-mono font-semibold text-foreground">{r.lead}</td>
              <td className="px-4 py-2 text-right font-mono font-semibold text-foreground">{r.cycle}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
