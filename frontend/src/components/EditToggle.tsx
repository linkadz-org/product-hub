import { useRef, useState, type ReactNode } from 'react';
import { Languages, Pencil } from 'lucide-react';
import { Button, RichText } from '@/components/ui';
import { t } from '@/i18n';

export interface EditToggleOptions {
  /** Prose styling for the read view, as passed to `RichText`. */
  className?: string;
  /** What to say when there's nothing written yet. */
  placeholder?: string;
  /**
   * Which side to open on. Descriptions open **read** — that's the point of
   * this: what's on screen by default is translatable, and it takes a button
   * press to put an editor in front of the text. A doc page opens `'edit'`,
   * because a doc page *is* the editor; there the same button is the way out.
   */
  start?: 'read' | 'edit';
  /**
   * Called just before the editor is taken off screen — pass the save guard's
   * `flush`. The editor unmounts inside this click's render pass, ahead of its
   * own deferred blur, so nothing else here would save the last thing typed.
   */
  onLeaveEdit?: () => void;
}

/**
 * Read by default, edit on purpose — and the reason is translation.
 *
 * A rich text editor cannot be translated in place: a page translator rewrites
 * the DOM, and in a contenteditable that DOM *is* the document, so translating
 * it means the next save writes a machine translation over what somebody wrote
 * (this is not hypothetical — it is the bug this exists for; see
 * `lib/contentGuard`). The editor is therefore marked `translate="no"`, which
 * on its own would leave anyone with edit rights unable to read a description
 * in their own language, since for them the description was *always* an editor.
 *
 * So the editor stops being the default. What a page shows is the same read
 * view a reader without edit rights gets: plain prose, no `translate="no"`, and
 * — the part that matters — **no editor mounted to save anything**. The
 * browser's own translator, which already has the reader's language set up, can
 * do what it likes to the pixels; nothing it touches can reach the server. One
 * button, always in the same place, opens the editor when there's actually
 * something to write.
 *
 * No API key, no service, no model download, no language picker: the translator
 * is the one already in the reader's browser. This just hands it something safe
 * to work on.
 *
 * @param html what to read — the stored value, never the editor's draft
 */
export function useEditToggle(
  html: string,
  { className, placeholder, start = 'read', onLeaveEdit }: EditToggleOptions = {},
) {
  const [editing, setEditing] = useState(start === 'edit');
  const leaveRef = useRef(onLeaveEdit);
  leaveRef.current = onLeaveEdit;

  const toggle = () =>
    setEditing((v) => {
      if (v) leaveRef.current?.();
      return !v;
    });

  /** The button. One place, always the same place — put it in the surface's
   *  existing chrome (the templates row, the doc byline). */
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={toggle}
      // No `aria-pressed`: the label already names the action rather than the
      // state, and a toggle that says both would say them the other way round.
      className="h-7 gap-1.5 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      {editing ? (
        <>
          <Languages className="size-3.5" aria-hidden />
          {t('readMode.show')}
        </>
      ) : (
        <>
          <Pencil className="size-3.5" aria-hidden />
          {t('readMode.edit')}
        </>
      )}
    </Button>
  );

  /** The read view, or `null` while editing — render the editor in its place.
   *  An empty description reads as its placeholder rather than as a blank gap,
   *  so the button still has something to sit under. */
  const view: ReactNode = editing ? null : html ? (
    <RichText html={html} className={className} />
  ) : (
    <p className="text-sm text-muted-foreground">{placeholder}</p>
  );

  return { editing, edit: () => setEditing(true), toggle, button, view };
}
