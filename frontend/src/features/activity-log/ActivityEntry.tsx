import { Badge } from '@/components/ui';
import { t, type I18nKey } from '@/i18n';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Avatar } from '@/features/activity/CommentThread';
import { describeEntry, type ActivityEntry as ActivityEntryData } from './entryText';

/** Field-name suffixes `relationLabel` can carry — matches
 *  `activityLog.relation.*` in `en.ts`/`ko.ts`. An unrecognised value (a
 *  future relation kind the frontend doesn't know yet) falls back to the raw
 *  string rather than a blank badge. */
function relationLabel(relation: string): string {
  const key = `activityLog.relation.${relation}` as I18nKey;
  const translated = t(key);
  return translated === key ? relation : translated;
}

/**
 * One system-event row in the merged Activity stream — a status change, a
 * field edit, and so on. Sits beside `CommentItem` in the same timeline, so
 * it matches its avatar-then-text layout, but reads as a log line rather than
 * a message (no card, muted text) and wraps on a narrow screen instead of
 * overflowing it.
 */
export function ActivityEntry({ entry }: { entry: ActivityEntryData }) {
  const { subject, verb, from, to, longText } = describeEntry(entry);
  const hasValues = !longText && (from || to);

  return (
    <div className="flex items-start gap-3 text-sm">
      <Avatar name={entry.actorType === 'system' ? '' : entry.actorName} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className={cn('font-semibold', entry.actorType === 'system' && 'italic')}>
          {subject}
        </span>
        <span className="text-muted-foreground">{verb}</span>
        {hasValues && (
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <span className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
              {from}
            </span>
            <span aria-hidden>→</span>
            <span className="max-w-[12rem] truncate rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
              {to}
            </span>
          </span>
        )}
        {entry.actorType === 'api' && (
          <Badge variant="muted">{t('activityLog.viaApiKey')}</Badge>
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
