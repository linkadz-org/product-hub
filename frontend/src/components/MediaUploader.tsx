import { useRef, type ReactNode } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import type { UploadedMedia } from '@/features/uploads/api';
import { useUploadQueue, type UploadQueue } from '@/features/uploads/useUploadQueue';
import { UploadProgressList } from '@/features/uploads/UploadProgressList';

interface MediaUploaderProps {
  /** Called once per successfully uploaded file. */
  onUploaded?: (media: UploadedMedia) => void;
  /**
   * Called once with everything that uploaded, after the last one lands. Use
   * this — not `onUploaded` — when the handler appends to a list: `onUploaded`
   * fires from the closure captured when the picker opened, so each file would
   * be added to the list as it stood *before* the batch, and only the last would
   * survive.
   */
  onUploadedAll?: (media: UploadedMedia[]) => void;
  /** File picker filter. Defaults to images + videos. */
  accept?: string;
  /** Button label. Defaults to "Upload". */
  label?: string;
  /**
   * Glyph shown before the label. Defaults to the upload arrow — override it
   * where the button sits in a row of *other* actions and needs to name what it
   * adds (a picture, say) rather than the fact that it uploads.
   */
  icon?: ReactNode;
  /** Allow selecting several files at once. */
  multiple?: boolean;
  size?: 'sm' | 'default';
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
  disabled?: boolean;
  /**
   * Where the per-file progress rows go. `'below'` (default) stacks them under
   * the button — the button becomes a column, which is what you want when it sits
   * on its own. Pass `'none'` where it's one item in a tight toolbar row and a
   * growing column would push the row apart; the button still counts up its own
   * percentage, so an upload is never silent either way.
   */
  progress?: 'below' | 'none';
  /**
   * Upload through a queue the caller owns, rather than the button's own.
   *
   * For a surface with a *second* way in — a drop zone, a paste handler — so both
   * routes feed one list of progress rows. Without it the drop and the button
   * each keep their own, and the same file dropped and then picked would show up
   * twice in two different places.
   */
  queue?: UploadQueue;
}

/**
 * The one uploader every media surface uses — bug attachments, report sections,
 * anywhere. A button that opens the file picker, uploads each pick to the
 * configured storage (sequentially, so one failure doesn't sink the rest), and
 * hands each result back via `onUploaded`.
 *
 * While it runs, the button counts the current file's percentage and a row per
 * file appears underneath with its own bar; a file the API turns down leaves its
 * row behind with the reason on it. It used to be a spinner and a toast, which
 * answered neither "how far along is it" nor, a minute later, "did that video
 * actually go up?".
 */
export function MediaUploader({
  onUploaded,
  onUploadedAll,
  accept = 'image/*,video/*',
  label,
  icon,
  multiple = true,
  size = 'sm',
  variant = 'secondary',
  className,
  disabled,
  progress = 'below',
  queue: sharedQueue,
}: MediaUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Always created (hooks can't be conditional); ignored when the caller shares
  // one of its own.
  const ownQueue = useUploadQueue();
  const queue = sharedQueue ?? ownQueue;
  const active = queue.tasks.find((task) => task.status === 'uploading');

  async function handleFiles(files: FileList | null) {
    const picked = files ? Array.from(files) : [];
    // Reset immediately so picking the same file again still fires onChange —
    // the input is done with as soon as we hold the File objects.
    if (inputRef.current) inputRef.current.value = '';
    if (picked.length === 0) return;
    const uploaded: UploadedMedia[] = await queue.upload(picked, (media) => onUploaded?.(media));
    if (uploaded.length) onUploadedAll?.(uploaded);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <div className={cn(progress === 'below' && queue.tasks.length > 0 && 'flex flex-col gap-2')}>
        <Button
          type="button"
          size={size}
          variant={variant}
          className={cn(className)}
          loading={queue.busy}
          disabled={disabled || queue.busy}
          onClick={() => inputRef.current?.click()}
        >
          {!queue.busy && (icon ?? <Upload className="mr-1.5 size-4" />)}
          {queue.busy
            ? `${t('uploads.uploading')} ${active?.percent ?? 0}%`
            : (label ?? t('uploads.add'))}
        </Button>
        {progress === 'below' && (
          <UploadProgressList tasks={queue.tasks} onDismiss={queue.dismiss} />
        )}
      </div>
    </>
  );
}
