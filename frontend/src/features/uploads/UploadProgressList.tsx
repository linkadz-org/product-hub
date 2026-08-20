import { AlertCircle, X } from 'lucide-react';
import { ProgressBar } from '@/components/ui';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/lib/format';
import { t } from '@/i18n';
import type { UploadTask } from './useUploadQueue';

/**
 * The live upload rows under whatever triggered them — one per file: its name,
 * how far along it is, and, if the API turned it down, why.
 *
 * Shared by every media surface (the composer's attach button, a doc's
 * attachments, a report section) so an upload looks and reads the same wherever
 * it's started. Renders nothing when there's nothing in flight, so it can sit
 * unconditionally in a layout.
 *
 * A failed row is a *row*, not a toast: it stays put next to the thing it was
 * dropped on until dismissed. A toast for this is gone in four seconds, and the
 * question ("did my video upload?") is usually asked later than that.
 */
export function UploadProgressList({
  tasks,
  onDismiss,
  className,
}: {
  tasks: UploadTask[];
  onDismiss: (id: string) => void;
  className?: string;
}) {
  if (tasks.length === 0) return null;
  return (
    <ul className={cn('flex w-full flex-col gap-1.5', className)}>
      {tasks.map((task) => {
        const failed = task.status === 'error';
        return (
          <li
            key={task.id}
            className={cn(
              'rounded-md border bg-card/60 px-2.5 py-1.5 text-xs',
              failed && 'border-destructive/40 bg-destructive/5',
            )}
          >
            <div className="flex items-center gap-2">
              {failed && <AlertCircle className="size-3.5 shrink-0 text-destructive" />}
              <span className="min-w-0 flex-1 truncate font-medium" title={task.name}>
                {task.name}
              </span>
              {/* The size is the answer to "why is this taking so long" — it costs
                  one muted column and saves the question. */}
              {!failed && task.size > 0 && (
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatFileSize(task.size)}
                </span>
              )}
              <span
                className={cn(
                  'shrink-0 tabular-nums',
                  failed ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {failed
                  ? t('uploads.failed')
                  : task.status === 'queued'
                    ? t('uploads.queued')
                    : `${task.percent}%`}
              </span>
              <button
                type="button"
                aria-label={t('uploads.dismiss')}
                title={t('uploads.dismiss')}
                onClick={() => onDismiss(task.id)}
                className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
            {failed ? (
              task.error && <p className="mt-1 text-destructive">{task.error}</p>
            ) : (
              <ProgressBar value={task.percent} className="mt-1.5 h-1" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
