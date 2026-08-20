import { useRef } from 'react';
import { AlertCircle, Paperclip, X } from 'lucide-react';
import { Spinner, useLightbox } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { isVideoUrl } from '@/features/uploads/useMediaAttachments';
import type { UploadedMedia } from '@/features/uploads/api';
import type { UploadTask } from '@/features/uploads/useUploadQueue';

/**
 * The media a posted comment carries — read-only. Images open in a lightbox
 * (click one, then arrow through the rest); short videos play inline. Type is
 * inferred from the stored URL. Renders nothing when the comment has no attachments.
 */
export function CommentMedia({ urls, className }: { urls: string[]; className?: string }) {
  const lightbox = useLightbox();
  if (!urls || urls.length === 0) return null;
  // The gallery the lightbox arrows through — the comment's images, in order.
  const gallery = urls.filter((u) => !isVideoUrl(u)).map((src) => ({ src }));
  return (
    <div className={cn('mt-2 flex flex-wrap gap-2', className)}>
      {urls.map((url, i) =>
        isVideoUrl(url) ? (
          <video
            key={i}
            src={url}
            controls
            className="max-h-56 w-auto max-w-full rounded-md border sm:max-w-[280px]"
          />
        ) : (
          <button
            key={i}
            type="button"
            aria-label={t('lightbox.title')}
            onClick={() => lightbox.open(gallery, gallery.findIndex((g) => g.src === url))}
            className="block rounded-md transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={url}
              alt=""
              loading="lazy"
              className="max-h-56 w-auto max-w-full cursor-zoom-in rounded-md border object-cover sm:max-w-[280px]"
            />
          </button>
        ),
      )}
      {lightbox.node}
    </div>
  );
}

/**
 * The pending attachments inside a composer — thumbnails a user can remove
 * before posting, and beside them one tile per file still going up.
 *
 * An in-flight tile counts its own percentage over a fill that rises to match, so
 * a 20MB video reads as *moving* rather than as the same spinner it was thirty
 * seconds ago. A rejected file keeps its tile, in red, with the API's reason on
 * hover — the toast that used to be the only word on it was gone long before
 * anyone noticed the attachment wasn't there.
 */
export function AttachmentStrip({
  items,
  tasks = [],
  onRemove,
  onDismissTask,
  className,
}: {
  items: UploadedMedia[];
  /** Live uploads from `useMediaAttachments().tasks`. */
  tasks?: UploadTask[];
  onRemove: (index: number) => void;
  onDismissTask?: (id: string) => void;
  className?: string;
}) {
  if (items.length === 0 && tasks.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap gap-2 px-1', className)}>
      {items.map((m, i) => (
        <div key={i} className="relative">
          {m.contentType.startsWith('video/') ? (
            <video src={m.url} className="size-16 rounded-md border object-cover" />
          ) : (
            <img src={m.url} alt={m.name} className="size-16 rounded-md border object-cover" />
          )}
          <button
            type="button"
            aria-label={t('uploads.remove')}
            className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-destructive"
            onClick={() => onRemove(i)}
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {tasks.map((task) => {
        const failed = task.status === 'error';
        return (
          <div
            key={task.id}
            title={failed ? `${task.name} — ${task.error}` : `${task.name} · ${task.percent}%`}
            className={cn(
              'relative size-16 overflow-hidden rounded-md border border-dashed',
              failed && 'border-solid border-destructive/50 bg-destructive/5',
            )}
          >
            {/* The fill *is* the progress — a bar under a 64px tile would be a
                line nobody can read, so the tile itself fills from the bottom. */}
            {!failed && (
              <div
                className="absolute inset-x-0 bottom-0 bg-primary/15 transition-[height]"
                style={{ height: `${task.percent}%` }}
              />
            )}
            <div className="relative grid size-full place-items-center gap-0.5 text-center">
              {failed ? (
                <AlertCircle className="size-4 text-destructive" />
              ) : task.status === 'queued' ? (
                <Spinner className="size-4" />
              ) : (
                <span className="text-xs font-medium tabular-nums">{task.percent}%</span>
              )}
            </div>
            {onDismissTask && (
              <button
                type="button"
                aria-label={failed ? t('uploads.dismiss') : t('common.cancel')}
                className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-destructive"
                onClick={() => onDismissTask(task.id)}
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** An icon button that opens the file picker as a click-to-attach fallback. */
export function AttachMediaButton({
  onFiles,
  disabled,
}: {
  onFiles: (files: FileList | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      <button
        type="button"
        aria-label={t('activity.attach')}
        title={t('activity.attach')}
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        <Paperclip className="size-4" />
      </button>
    </>
  );
}
