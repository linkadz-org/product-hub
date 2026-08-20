import { t } from '@/i18n';

/** A live upload indicator for an Editor.js block. */
export interface UploadProgressBar {
  /** Drop this into the block's wrapper. */
  el: HTMLElement;
  /** 0–100. */
  set(percent: number): void;
  /** Turn the bar into a red row with the API's reason on it. */
  fail(message: string): void;
}

/**
 * The "this file is going up" placeholder an image or video block shows in place
 * of itself while it uploads: the file's name, a percentage, and a bar that
 * fills.
 *
 * Editor.js tools are plain DOM — no React, no access to the app's components —
 * so this is built by hand and styled inline off the same CSS custom properties
 * the rest of the app themes with, which keeps it correct in dark mode without a
 * stylesheet of its own. It replaces a picker button whose entire report was the
 * word "Uploading…", frozen there for however long a 20MB screen recording takes.
 */
export function createUploadProgressBar(fileName: string): UploadProgressBar {
  const el = document.createElement('div');
  el.style.cssText =
    'margin:0.6em 0;padding:10px 12px;border:1px solid hsl(var(--border));border-radius:8px;background:hsl(var(--card))';

  const row = document.createElement('div');
  row.style.cssText =
    'display:flex;align-items:center;gap:8px;font-size:12px;color:hsl(var(--muted-foreground))';

  const name = document.createElement('span');
  name.textContent = fileName;
  name.title = fileName;
  name.style.cssText = 'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:hsl(var(--foreground))';

  const pct = document.createElement('span');
  pct.textContent = '0%';
  pct.style.cssText = 'flex:none;font-variant-numeric:tabular-nums';

  row.append(name, pct);

  const track = document.createElement('div');
  track.style.cssText =
    'margin-top:8px;height:4px;border-radius:9999px;background:hsl(var(--secondary));overflow:hidden';
  const fill = document.createElement('div');
  fill.style.cssText =
    'height:100%;width:0%;border-radius:9999px;background:hsl(var(--primary));transition:width .15s linear';
  track.append(fill);

  el.append(row, track);

  return {
    el,
    set(percent: number) {
      const p = Math.max(0, Math.min(100, Math.round(percent)));
      fill.style.width = `${p}%`;
      // The last byte leaving the browser isn't the same as the server having
      // stored it, so 100% says "finishing" rather than sitting on a full bar
      // pretending to be done.
      pct.textContent = p >= 100 ? t('uploads.finishing') : `${p}%`;
    },
    fail(message: string) {
      el.style.borderColor = 'hsl(var(--destructive))';
      pct.textContent = t('uploads.failed');
      pct.style.color = 'hsl(var(--destructive))';
      track.remove();
      const reason = document.createElement('p');
      reason.textContent = message;
      reason.style.cssText = 'margin:6px 0 0;font-size:12px;color:hsl(var(--destructive))';
      el.append(reason);
    },
  };
}
