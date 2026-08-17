import { Fragment, type ReactNode } from 'react';
import { Badge } from '@/components/ui';
import { t, type I18nKey } from '@/i18n';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar } from '@/features/activity/Avatar';
import {
  describeEntry,
  type ActivityEntry as ActivityEntryData,
  type SentenceSlot,
} from './entryText';

/** The `relationLabel` values the backend emits (`get-activity.use-case.ts`),
 *  mapped to their i18n keys. A literal map rather than a constructed
 *  `` `activityLog.relation.${relation}` `` key: the constructed form defeats
 *  the closed `I18nKey` union, so a renamed backend label would degrade to a
 *  raw English token at runtime instead of failing the typecheck here. */
const RELATION_LABEL: Record<string, I18nKey> = {
  subtask: 'activityLog.relation.subtask',
  doc: 'activityLog.relation.doc',
  roadmap_item: 'activityLog.relation.roadmap_item',
  testcase: 'activityLog.relation.testcase',
};

/** An unrecognised relation (a future kind the frontend doesn't know yet) falls
 *  back to the raw string rather than a blank badge. */
function relationLabel(relation: string): string {
  const key = RELATION_LABEL[relation];
  return key ? t(key) : relation;
}

/**
 * One system-event row in the merged Activity stream — a status change, a
 * field edit, and so on. Sits beside `CommentItem` in the same timeline, so
 * it matches its avatar-then-text layout, but reads as a log line rather than
 * a message (no card, muted text) and wraps on a narrow screen instead of
 * overflowing it.
 */
export function ActivityEntry({ entry }: { entry: ActivityEntryData }) {
  const { subject, field, verb, from, to, order } = describeEntry(entry);

  // The three orderable slots. `order` — read off this locale's own
  // `activityLog.sentence` template — decides which appear and in what
  // sequence; this component must not have an opinion. English reads
  // "changed status [Backlog] → [Done]", Korean "상태를 [Backlog] → [Done] 변경함".
  const slots: Record<SentenceSlot, ReactNode> = {
    field: <span className="min-w-0 truncate text-muted-foreground">{field}</span>,
    verb: <span className="text-muted-foreground">{verb}</span>,
    // Wraps internally: at ~320px two value chips plus the arrow can't share a
    // line, and the arrow must stay between them rather than stranding at the
    // end of the row.
    values: (
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-muted-foreground">
        <span className="max-w-[8rem] truncate rounded bg-muted px-1.5 py-0.5 text-xs text-foreground sm:max-w-[12rem]">
          {from}
        </span>
        <span aria-hidden>→</span>
        <span className="max-w-[8rem] truncate rounded bg-muted px-1.5 py-0.5 text-xs text-foreground sm:max-w-[12rem]">
          {to}
        </span>
      </span>
    ),
  };

  return (
    <div className="flex items-start gap-3 text-sm">
      <Avatar name={entry.actorType === 'system' ? '' : entry.actorName} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        {/* An unbroken actor name (an API key's, say) must not push the row
            wider than its column. */}
        <span
          className={cn(
            'min-w-0 max-w-full truncate font-semibold',
            entry.actorType === 'system' && 'italic',
          )}
        >
          {subject}
        </span>
        {order.map((slot) => (
          <Fragment key={slot}>{slots[slot]}</Fragment>
        ))}
        {entry.actorType === 'api' && (
          <Badge variant="muted">{t('activityLog.viaApiKey')}</Badge>
        )}
        {/* A system actor already reads as "Automatically" in the subject — the
            badge would be the same fact twice. It still shows for the automated
            writes that carry a real person's name (a cycle rebuild detaching
            issues, a doc duplicate/delete cascading to its pages). */}
        {entry.automated && entry.actorType !== 'system' && (
          <Badge variant="muted">{t('activityLog.automated')}</Badge>
        )}
        {entry.relationLabel && (
          <Badge variant="outline">{relationLabel(entry.relationLabel)}</Badge>
        )}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {timeAgo(entry.createdAt)}
        </span>
      </div>
    </div>
  );
}
