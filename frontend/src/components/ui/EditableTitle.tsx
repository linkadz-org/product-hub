import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** The heading type every detail page writes its title in. Both faces share it,
 *  so nothing shifts when one swaps for the other. */
const TYPE = 'text-2xl font-semibold tracking-tight';

export interface EditableTitleProps {
  /** What's stored. The editing face is always seeded from this, never from
   *  what's on screen — see the note about translation below. */
  value: string;
  /** Persist a new title. Called on blur, and on Enter, only when it changed. */
  onSave: (title: string) => void;
  /** Shown in place of an empty title, and used as the field's label. */
  placeholder: string;
  /** Read-only for a viewer who can't edit — no focus, no swap. */
  canWrite?: boolean;
  className?: string;
}

/**
 * A detail page's title: a heading you can read, and an editor when you mean to
 * edit it.
 *
 * Two things drove this, and they turn out to be the same thing.
 *
 * **It wraps.** A title lived in an `<input>`, and an input has exactly one line
 * to give: a long title scrolled sideways past its own right edge, so the end of
 * it simply wasn't on the page. The editing face is a `<textarea>` that grows to
 * its content and the reading face is an ordinary heading, so both wrap. The
 * *value* stays one line — Enter commits, and a pasted line break folds to a
 * space — it just stops hiding.
 *
 * **It translates.** A browser page translator rewrites text nodes and leaves
 * form values alone, so a title in an input was the one thing on the page that
 * stayed in a language the reader might not have. As a heading it translates
 * with everything around it. That's safe here for the same structural reason the
 * description's read view is safe (`components/EditToggle`): a translated
 * heading has nothing to save. Focus it and the textarea that appears is seeded
 * from `value` — the stored title, not the translation on screen — so what a
 * translator did to the pixels can't be typed back into the database.
 *
 * Focus is the whole interaction: `tabIndex` puts the heading in the tab order
 * where the input used to be, and anything that focuses it — a click, a Tab —
 * swaps in the editor. There is no "edit" affordance to find because the title
 * behaves like the field it replaced.
 */
export function EditableTitle({
  value,
  onSave,
  placeholder,
  canWrite = true,
  className,
}: EditableTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;

  // Grow to fit before paint, so a wrapped title never flashes at one line.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  // Entering: seed from what's stored and put the caret at the end, where
  // someone who clicked a title to fix its last word expects it.
  const open = () => {
    if (!canWrite || editing) return;
    setDraft(value);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const close = (commit: boolean) => {
    const next = (draft ?? '').trim();
    setDraft(null);
    // An empty title isn't a title — leaving the field blank reverts rather
    // than wiping the name off a ticket other people are looking at.
    if (commit && next && next !== value) onSave(next);
  };

  if (!editing) {
    return (
      <h1
        className={cn(
          'min-w-0 flex-1 break-words',
          TYPE,
          canWrite && 'cursor-text rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !value && 'text-muted-foreground',
          className,
        )}
        tabIndex={canWrite ? 0 : undefined}
        onFocus={open}
        onClick={open}
      >
        {value || placeholder}
      </h1>
    );
  }

  return (
    <textarea
      ref={ref}
      // The editor is the one place the stored words live on screen, so it is
      // the one place a translator must not touch.
      translate="no"
      className={cn(
        'notranslate min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground',
        TYPE,
        className,
      )}
      rows={1}
      value={draft}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(e) => setDraft(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          close(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          close(false);
        }
      }}
      onBlur={() => close(true)}
    />
  );
}
