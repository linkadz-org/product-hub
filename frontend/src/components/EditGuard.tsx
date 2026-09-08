import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import { t } from '@/i18n';
import { htmlToPlainText, isPageTranslated, replacedRatio } from '@/lib/contentGuard';

export interface HtmlSaveGuardOptions {
  /** What's stored right now — the version a save would replace. */
  saved: string;
  /** Persist the new HTML. Called only for a save that passed the guard, or one
   *  the author confirmed in the dialog. */
  onSave: (html: string) => void;
  /**
   * Below this much stored text, save without asking. A one-line description
   * swings the ratio wildly (rewrite three words out of four and it's 75%), and
   * a line is not what anyone is afraid of losing.
   */
  minChars?: number;
  /** How much of the stored text may disappear before we ask. */
  threshold?: number;
  /**
   * Put the stored text back in front of the author after they decline a save.
   *
   * Bumping `nonce` in the editor's `key` is enough where the editor's `value`
   * *is* the stored field (task, bug, backlog item). A surface that mounts the
   * editor from a seed of its own — the doc page, which re-seeds on a version
   * restore — refreshes that seed here instead, so the remount doesn't put a
   * stale copy of the page back on screen.
   */
  onRevert?: () => void;
}

export interface HtmlSaveGuard {
  /** Wire to the editor's `onChange`: remembers the draft, saves nothing. */
  draft: (html: string) => void;
  /** Wire to the editor's `onBlur`: this is the save. */
  commit: (html: string) => void;
  /** Put in the editor's `key` — bumping it remounts the editor with what's
   *  stored, so "Keep the saved version" visibly puts the text back. */
  nonce: number;
  /** Render somewhere in the tree; nothing until a save is held back. */
  dialog: ReactNode;
}

/**
 * Save a rich-text field on blur, and refuse to quietly throw away what's
 * already written.
 *
 * The pairing matters. `onChange` fires for every DOM mutation the editor
 * sees — including ones the author didn't make (a browser page translator
 * rewriting the text, an extension "fixing" it) — so it only ever records a
 * draft here. The save happens on blur, when a person has finished and moved
 * on, and it goes out only if the new text still contains most of the old one.
 * Over `threshold`, the author is asked, with the number in front of them; if
 * the field is torn down or the tab is hidden mid-edit, the draft is flushed on
 * the same terms, silently dropped rather than saved when it looks like a
 * rewrite (the server still holds the original, which is the recoverable side
 * of that choice).
 *
 * @see lib/contentGuard for how "most of the old one" is measured.
 */
export function useHtmlSaveGuard({
  saved,
  onSave,
  minChars = 40,
  threshold = 0.8,
  onRevert,
}: HtmlSaveGuardOptions): HtmlSaveGuard {
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // The last HTML we sent up. `saved` only catches up once the mutation
  // round-trips, and a blur can easily beat it back.
  const sentRef = useRef(saved);
  const draftRef = useRef<string | null>(null);
  const [held, setHeld] = useState<{ html: string; percent: number; translated: boolean } | null>(
    null,
  );
  const [nonce, setNonce] = useState(0);

  /** Save `html`, unless too much of the stored text would go missing. */
  const attempt = useCallback(
    (html: string, opts?: { silent?: boolean }) => {
      if (html === savedRef.current || html === sentRef.current) return;
      const before = htmlToPlainText(savedRef.current);
      const ratio = replacedRatio(before, htmlToPlainText(html));
      if (before.length >= minChars && ratio >= threshold) {
        // Nothing is saved on this path. Silent (unmount, tab hidden) means
        // there's no one to ask, so the stored version simply stands.
        if (!opts?.silent) {
          setHeld({ html, percent: Math.round(ratio * 100), translated: isPageTranslated() });
        }
        return;
      }
      draftRef.current = null;
      sentRef.current = html;
      onSaveRef.current(html);
    },
    [minChars, threshold],
  );

  const draft = useCallback((html: string) => {
    draftRef.current = html;
  }, []);

  const commit = useCallback(
    (html: string) => {
      draftRef.current = html;
      attempt(html);
    },
    [attempt],
  );

  // An edit in progress when the field goes away — a route change, the drawer
  // closing, the tab being hidden — never had its blur. Flush it here on the
  // same terms; blur-only saving would otherwise lose the last paragraph.
  useEffect(() => {
    const flush = () => {
      const pending = draftRef.current;
      if (pending != null) attempt(pending, { silent: true });
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  }, [attempt]);

  const onRevertRef = useRef(onRevert);
  onRevertRef.current = onRevert;
  const dismiss = useCallback(() => {
    // Drop the draft and remount the editor on what's stored: the text on
    // screen is the rewrite, and leaving it there invites the author to save it
    // by accident a second time.
    draftRef.current = null;
    setHeld(null);
    setNonce((n) => n + 1);
    onRevertRef.current?.();
  }, []);

  const dialog = held ? (
    <Dialog
      open
      onClose={dismiss}
      title={t('editGuard.title')}
      footer={
        <>
          <Button variant="outline" onClick={dismiss}>
            {t('editGuard.keep')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const html = held.html;
              setHeld(null);
              draftRef.current = null;
              sentRef.current = html;
              onSaveRef.current(html);
            }}
          >
            {t('editGuard.saveAnyway')}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" aria-hidden />
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{t('editGuard.body').replace('{percent}', String(held.percent))}</p>
          {held.translated && (
            <p className="font-medium text-foreground">{t('editGuard.translated')}</p>
          )}
          <p>{t('editGuard.hint')}</p>
        </div>
      </div>
    </Dialog>
  ) : null;

  return { draft, commit, nonce, dialog };
}
