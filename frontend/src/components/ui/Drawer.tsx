import { type ReactNode, useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { keepOpenOnToastClick } from './sonner';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the panel (visually hidden; the body carries the heading). */
  title?: string;
  /** Actions rendered in the header row, left of the close button — e.g. an
   *  "open full page" link. */
  headerActions?: ReactNode;
  children: ReactNode;
  /** Width cap on ≥sm; full-width below it. Defaults to a comfortable reading size.
   *  It's the *starting* width — the left edge drags to resize from it. */
  widthClassName?: string;
  className?: string;
}

const MIN_WIDTH = 320;
/** Leaves a strip of the page showing, so the overlay stays clickable to close. */
const PAGE_GUTTER = 48;

/**
 * The drawer's dragged width, remembered per default size — a peek widened for
 * reading shouldn't make the narrow doc-styles drawer open wide too. `null` means
 * "never resized": the drawer keeps its `widthClassName` and stays responsive.
 */
function useDrawerWidth(storageKey: string) {
  const max = () => Math.max(MIN_WIDTH, window.innerWidth - PAGE_GUTTER);
  const clamp = (w: number) => Math.round(Math.min(max(), Math.max(MIN_WIDTH, w)));

  const [width, setWidth] = useState<number | null>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return saved > 0 ? saved : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (width == null) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(width));
    } catch {
      // Storage refused (private mode) — the width just won't survive a reload.
    }
  }, [storageKey, width]);

  return { width, setWidth, clamp };
}

/**
 * A right-anchored slide-over ("peek") panel, backed by the same Radix Dialog as
 * {@link Dialog} (portal, focus trap, scroll lock, Esc/overlay to close) but
 * pinned full-height to the right edge and sliding in from it. Used to preview an
 * issue in place — e.g. clicking a sub-task opens its detail here instead of
 * navigating away. Full-width on mobile, capped on desktop — where its left edge
 * drags to resize (double-click resets), remembered per default size.
 */
export function Drawer({
  open,
  onClose,
  title,
  headerActions,
  children,
  widthClassName = 'sm:max-w-2xl',
  className,
}: DrawerProps) {
  const { width, setWidth, clamp } = useDrawerWidth(`drawer.width:${widthClassName}`);
  const contentRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // Same reasoning as the sidebar grip (`useResizableWidth`): undo the page-level
  // cursor/no-select if the drawer closes mid-drag.
  const endDrag = useRef<() => void>();
  useEffect(() => () => endDrag.current?.(), []);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const startX = e.clientX;
    // Never resized yet → start from what the class rendered, so the first pixel
    // of drag doesn't jump the panel.
    const startWidth = width ?? contentRef.current?.getBoundingClientRect().width ?? MIN_WIDTH;
    el.setPointerCapture(e.pointerId);
    setDragging(true);

    const { style } = document.body;
    const prev = { cursor: style.cursor, select: style.userSelect };
    style.cursor = 'col-resize';
    style.userSelect = 'none';

    // Anchored right, so dragging the left edge *left* widens it.
    const onMove = (ev: PointerEvent) => setWidth(clamp(startWidth + startX - ev.clientX));
    const stop = () => {
      setDragging(false);
      style.cursor = prev.cursor;
      style.userSelect = prev.select;
      el.releasePointerCapture?.(e.pointerId);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
      endDrag.current = undefined;
    };
    endDrag.current = stop;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  };

  const nudge = (delta: number) =>
    setWidth(clamp((width ?? contentRef.current?.getBoundingClientRect().width ?? MIN_WIDTH) + delta));

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          ref={contentRef}
          aria-describedby={undefined}
          onInteractOutside={keepOpenOnToastClick}
          // A dragged width rides in a CSS variable so it only applies from `sm` —
          // below that the drawer stays full-width, resized or not.
          style={width != null ? ({ '--drawer-w': `${width}px` } as React.CSSProperties) : undefined}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l bg-background shadow-xl outline-none',
            'duration-300 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            width != null ? 'sm:w-[var(--drawer-w)] sm:max-w-[calc(100vw-3rem)]' : widthClassName,
            className,
          )}
        >
          {/* Resize grip — straddles the left border so the grab target is 8px
              while the line you aim at stays the panel's 1px edge. Desktop only. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t('drawer.resize')}
            aria-valuenow={width ?? undefined}
            aria-valuemin={MIN_WIDTH}
            tabIndex={0}
            title={t('drawer.resizeHint')}
            onPointerDown={startDrag}
            onDoubleClick={() => setWidth(null)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 64 : 16;
              if (e.key === 'ArrowLeft') nudge(step);
              else if (e.key === 'ArrowRight') nudge(-step);
              else if (e.key === 'Enter') setWidth(null);
              else return;
              e.preventDefault();
            }}
            className="group absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none outline-none sm:block"
          >
            <span
              className={cn(
                'absolute inset-y-0 left-[3px] w-0.5 rounded-full bg-primary transition-opacity duration-150',
                dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
              )}
              aria-hidden
            />
          </div>
          <DialogPrimitive.Title className="sr-only">{title ?? 'Detail'}</DialogPrimitive.Title>
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 items-center gap-1">{headerActions}</div>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('common.close')}
                className="size-7 shrink-0 text-muted-foreground"
              >
                <X />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
