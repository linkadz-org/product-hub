import { useRef, useState, type DragEvent, type MouseEvent } from 'react';
import {
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Paperclip,
  Presentation,
  X,
} from 'lucide-react';
import { MediaUploader } from '@/components/MediaUploader';
import { useLightbox } from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { formatFileSize } from '@/lib/format';
import { useUploadQueue } from '@/features/uploads/useUploadQueue';
import { isVideoUrl } from '@/features/uploads/useMediaAttachments';
import { UploadProgressList } from '@/features/uploads/UploadProgressList';

/**
 * One stored file, as the upload endpoint returns it. `DocAttachment` and
 * `BugAttachment` are this shape — the bar takes the structural type so a doc
 * page and an issue attach files through the same component.
 */
export interface AttachmentFile {
  url: string;
  name: string;
  contentType: string;
  size: number;
}

interface AttachmentBarProps {
  items: AttachmentFile[];
  /** Read-only when false: chips still download, nothing can be added or removed. */
  canWrite: boolean;
  /** The whole list after the change — the owner saves it as one field. */
  onChange?: (next: AttachmentFile[]) => void;
  className?: string;
}

/**
 * What the file picker offers. Mirrors the backend's `DOCUMENT_TYPE_BY_EXT` plus
 * images, which the API already accepts — someone attaching a screenshot beside
 * the spec shouldn't be told to put it in the body instead.
 */
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.md,.rtf,image/*,video/*';

/**
 * How a file is shown: `image` as a zoomable thumbnail, `video` as an inline
 * player, everything else as a chip.
 *
 * The stored content type decides it, with the URL's extension as the fallback —
 * an attachment written by MCP may carry an empty `contentType` (it's optional
 * on that DTO), and a clip landing in the chip row is exactly the "why won't
 * this play" this split exists to remove.
 */
function mediaKind(file: AttachmentFile): 'image' | 'video' | 'file' {
  const type = file.contentType.toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (!type && isVideoUrl(file.url)) return 'video';
  if (!type && /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i.test(file.url)) return 'image';
  return 'file';
}

/**
 * The glyph for a file, by stored content type. Monochrome on purpose: a row of
 * red/green/blue file icons would be the only place in the app inventing colour
 * outside the brand palette.
 */
function glyphFor(contentType: string, name: string) {
  const type = contentType.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  if (type.startsWith('image/')) return FileImage;
  if (type.startsWith('video/')) return FileVideo;
  if (type.includes('spreadsheet') || type === 'text/csv' || ext === 'xls' || ext === 'csv')
    return FileSpreadsheet;
  if (type.includes('presentation') || ext === 'ppt' || ext === 'pptx') return Presentation;
  if (type === 'application/pdf' || type.startsWith('text/') || type.includes('word'))
    return FileText;
  return FileIcon;
}

/**
 * The ✕ on a media tile — the same corner badge a comment's staged attachments
 * carry (see `AttachmentStrip`), shared here so a thumbnail and a video tile
 * can't drift apart.
 */
function TileRemove({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={t('attachments.remove')}
      title={t('attachments.remove')}
      onClick={onClick}
      className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-sm hover:text-destructive"
    >
      <X className="size-3" />
    </button>
  );
}

/**
 * The files attached to one record — a doc page or an issue (task / bug) — as a
 * row of chips.
 *
 * Uploads go straight to the workspace storage and the new list is handed back
 * for the owner to save — there's no staging step, because none of the surfaces
 * using this have a Save button to stage anything for. Dropping files onto the
 * row works too; the drop target is the row itself rather than the whole page, so
 * it never competes with an editor's own drag handling for images.
 */
export function AttachmentBar({ items, canWrite, onChange, className }: AttachmentBarProps) {
  const [dragging, setDragging] = useState(false);
  // Depth counter so dragging across the chips inside doesn't flicker the hint.
  const depth = useRef(0);
  // Dropped files go through the same queue the pick-a-file button does, so a
  // drop reports its progress instead of being the one silent path in.
  const queue = useUploadQueue();
  // The zoom viewer behind the thumbnails — the same one a comment's images and
  // a doc's body open into, so "click a picture" means one thing app-wide.
  const lightbox = useLightbox();

  // Pictures get a thumbnail, clips a player, everything else a chip — there's
  // nothing to preview in a .docx, and a row of identical glyph tiles would say
  // less than the filenames do.
  const images = items.filter((f) => mediaKind(f) === 'image');
  const videos = items.filter((f) => mediaKind(f) === 'video');
  const files = items.filter((f) => mediaKind(f) === 'file');
  // What the viewer arrows through — every image here, in order, whichever one
  // was clicked.
  const gallery = images.map((f) => ({ src: f.url, alt: f.name }));

  // Nothing attached and nothing to attach with — don't leave an empty rule
  // across the page (this is how it renders on a public view).
  if (!items.length && !canWrite) return null;

  async function uploadAll(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    // Appended as one batch: `items` is captured from this render, so adding one
    // at a time would make every file overwrite the one before it.
    const added = await queue.upload(list);
    if (added.length) onChange?.([...items, ...added]);
  }

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const dropHandlers = canWrite
    ? {
        onDragEnter: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth.current += 1;
          setDragging(true);
        },
        onDragOver: (e: DragEvent) => {
          if (hasFiles(e)) e.preventDefault();
        },
        onDragLeave: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setDragging(false);
        },
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          depth.current = 0;
          setDragging(false);
          void uploadAll(e.dataTransfer.files);
        },
      }
    : {};

  const remove = (file: AttachmentFile) =>
    onChange?.(items.filter((f) => f.url !== file.url));

  /**
   * A plain left click zooms; every "open it over there" gesture the browser
   * already understands is left alone — ⌘/Ctrl-click, Shift-click, middle click
   * and "Open in new tab" all follow the href, which is why the tile is an
   * anchor rather than the button a comment's thumbnail uses.
   */
  const zoomOn = (index: number) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    lightbox.open(gallery, index);
  };

  return (
    <div
      {...dropHandlers}
      className={cn(
        'flex flex-col gap-2 rounded-md transition-colors',
        dragging && 'bg-primary/5 outline-dashed outline-1 outline-offset-2 outline-primary/40',
        className,
      )}
    >
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((file, i) => (
            <span key={file.url} className="relative">
              <a
                href={file.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={zoomOn(i)}
                title={`${file.name}${formatFileSize(file.size) ? ` · ${formatFileSize(file.size)}` : ''}`}
                className="block overflow-hidden rounded-md border transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <img
                  src={file.url}
                  alt={file.name}
                  loading="lazy"
                  className="h-24 w-32 cursor-zoom-in bg-muted/40 object-cover"
                />
              </a>
              {canWrite && <TileRemove onClick={() => remove(file)} />}
            </span>
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {videos.map((file) => (
            <span key={file.url} className="relative">
              {/* Plays where it hangs, like a clip attached to a comment — a repro
                  screen recording is the one attachment nobody should have to
                  open a second tab for. `metadata` so the poster frame appears
                  without pulling a 20MB file nobody pressed play on. */}
              <video
                src={file.url}
                controls
                preload="metadata"
                title={file.name}
                className="max-h-56 w-auto max-w-full rounded-md border bg-muted/40 sm:max-w-[280px]"
              />
              {canWrite && <TileRemove onClick={() => remove(file)} />}
            </span>
          ))}
        </div>
      )}

      {(files.length > 0 || canWrite) && (
        <div className="flex flex-wrap items-center gap-2">
          {files.map((file) => {
            const Glyph = glyphFor(file.contentType, file.name);
            const size = formatFileSize(file.size);
            return (
              <span
                key={file.url}
                className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2 pr-1 text-xs"
              >
                <Glyph className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={file.name}
                  title={file.name}
                  className="max-w-[180px] truncate font-medium text-foreground hover:text-primary sm:max-w-[220px]"
                >
                  {file.name}
                </a>
                {size && <span className="shrink-0 text-muted-foreground">{size}</span>}
                {canWrite ? (
                  <button
                    type="button"
                    aria-label={t('attachments.remove')}
                    title={t('attachments.remove')}
                    onClick={() => remove(file)}
                    className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                ) : (
                  <span className="w-1" aria-hidden />
                )}
              </span>
            );
          })}

          {canWrite && (
            <>
              <MediaUploader
                accept={ACCEPT}
                variant="ghost"
                label={t('attachments.add')}
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                // One queue for both ways in (button and drop), and one list of
                // rows for it — drawn below rather than wedged into this row.
                queue={queue}
                progress="none"
                // The batch callback, not the per-file one: picking four files at
                // once has to append four, not overwrite three (see MediaUploader).
                onUploadedAll={(added) => onChange?.([...items, ...added])}
              />
              {/* Only worth saying while it's empty — after that the row explains itself. */}
              {!items.length && (
                <span className="hidden items-center gap-1 text-xs text-muted-foreground/70 sm:inline-flex">
                  <Paperclip className="size-3" aria-hidden /> {t('attachments.hint')}
                </span>
              )}
            </>
          )}
        </div>
      )}

      {canWrite && <UploadProgressList tasks={queue.tasks} onDismiss={queue.dismiss} />}
      {lightbox.node}
    </div>
  );
}

/**
 * The Attachments block as a detail page shows it: the eyebrow heading + count
 * used by the neighbouring SUB-TASKS / DOCS sections, over the bar itself.
 * Shared so an open issue and the New task / New bug forms grow the same section
 * rather than two that drifted.
 *
 * Renders nothing when there is nothing to show and no way to add — a read-only
 * (public) view of an issue with no files stays as it was.
 */
export function AttachmentSection({ items, canWrite, onChange, className }: AttachmentBarProps) {
  if (!items.length && !canWrite) return null;
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Paperclip className="size-3.5" aria-hidden />
        {t('attachments.title')}
        {items.length > 0 && <span className="tabular-nums">({items.length})</span>}
      </h3>
      <AttachmentBar items={items} canWrite={canWrite} onChange={onChange} />
    </section>
  );
}
