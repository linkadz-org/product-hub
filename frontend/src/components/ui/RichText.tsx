import { useCallback, useEffect, useRef, type MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { enhanceCodeBlocks } from '@/lib/enhanceCodeBlocks';
import { enhanceTables } from '@/lib/enhanceTables';
import { foldListIndents, isRichHtml, normalizeSpaces, plainTextToHtml } from '@/lib/editorjs';
import { renderMermaidBlocks } from '@/lib/mermaid';
// The read-only view paints editor output — code-copy buttons and mermaid
// diagrams both need these rules, on pages that never mount the editor itself.
import '@/styles/rich-text-editor.css';
import { isWebLink, resolveHref, useExternalLink } from './ExternalLink';
import { collectImages, useLightbox } from './Lightbox';

/** Shared prose styling for editor HTML — links, images (click-to-zoom cursor).
 *  `rich-text-content` is the read-view half of the content rules the editor
 *  scopes to `.rich-text-editor` (code chips, table gridlines — see
 *  styles/rich-text-editor.css); without it the same HTML reads differently
 *  depending on whether you happen to be allowed to edit it. */
const PROSE =
  'rich-text-content [&_a]:cursor-pointer [&_a]:text-primary [&_a]:underline [&_img]:h-auto [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-md';

export interface RichTextProps {
  /** Stored rich-text value as HTML (what the editor emits). */
  html: string;
  className?: string;
}

/**
 * Read-only renderer for the HTML our `RichTextEditor` produces. Beyond painting
 * the markup it makes the content behave the way a reader expects, and does so in
 * one place so every description/detail surface reads identically:
 *  · links open in a new tab (`rel=noopener`); off-domain links ask first;
 *  · embedded images open in a lightbox — click any image, arrow through the rest;
 *  · code blocks get the same hover "copy" button as the editor.
 *
 * Drop-in for the old `<div className="[&_a]… [&_img]…" dangerouslySetInnerHTML>`
 * blocks; pass surface-specific type styles (e.g. `text-sm text-muted-foreground`)
 * via `className`.
 */
export function RichText({ html, className }: RichTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lightbox = useLightbox();
  const links = useExternalLink();

  // Decorate links (target/rel) and add code-copy buttons whenever the HTML
  // changes. Click behaviour itself is delegated on the container below.
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    // The same two repairs the editor makes on the way in, so a document pasted
    // out of a word processor reads the same to someone who can't edit it:
    // word-joining `&nbsp;` back to spaces (they wrap; a run of them doesn't), and
    // an indent written as an empty bullet folded onto the line it belongs to.
    normalizeSpaces(root);
    foldListIndents(root);
    enhanceCodeBlocks(root);
    // Wide tables scroll inside their own box instead of widening the page.
    const untrackTables = enhanceTables(root);
    // Diagrams are stored as source, so the picture only exists once it's drawn.
    // Fire-and-forget: mermaid loads lazily and a failure prints in its own box.
    void renderMermaidBlocks(root);
    root.querySelectorAll('a[href]').forEach((a) => {
      if (isWebLink(resolveHref(a.getAttribute('href') || ''))) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return untrackTables;
  }, [html]);

  const onClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const root = ref.current;
      if (!root) return;
      const el = e.target as HTMLElement;

      // Image → open the lightbox, seeded with every image in this block so the
      // reader can arrow through them from wherever they clicked.
      const img = el.closest('img');
      if (img && root.contains(img)) {
        const { images, indexOf } = collectImages(root);
        e.preventDefault();
        lightbox.open(images, indexOf(img as HTMLImageElement));
        return;
      }

      // Link → new tab, off-domain ones after a confirmation. The guard opens it,
      // so stop the anchor from opening a second copy of the same tab.
      const a = el.closest('a');
      if (a && root.contains(a) && links.open(a.getAttribute('href') || '')) {
        e.preventDefault();
      }
    },
    [lightbox, links],
  );

  // Plain text (an old value, or one an API client stored unconverted) is shown
  // a paragraph per line — painted as markup it would run every line together.
  // A blank line keeps its height, the way the author left a gap.
  const plain = !isRichHtml(html);

  return (
    <>
      <div
        ref={ref}
        className={cn(PROSE, plain && '[&_p:empty]:min-h-[1lh]', className)}
        onClick={onClick}
        dangerouslySetInnerHTML={{ __html: plain ? plainTextToHtml(html) : html }}
      />
      {lightbox.node}
      {links.node}
    </>
  );
}
