/**
 * Guards written content against a rewrite nobody asked for.
 *
 * The case this exists for: a browser page translator (Google Translate, Edge's
 * built-in one) rewrites the *DOM* in place. Inside a rich text editor that DOM
 * **is** the document, so a translation looks exactly like the author having
 * retyped every word — and an editor that saves what it sees will happily PATCH
 * the translation over the original. There is no undo for that.
 *
 * Two defences, and this file is the second one:
 *  1. the editor is marked `translate="no"`, so a translator skips it entirely
 *     (`RichTextEditor`);
 *  2. this — before a save goes out, measure how much of the *stored* text has
 *     disappeared. A translation drops ~all of it; ordinary editing drops a few
 *     words. Over the threshold, the caller asks first (`useHtmlSaveGuard`).
 */

/** Letters and digits in any script — Korean and Vietnamese included. */
const TOKEN = /[\p{L}\p{N}]+/gu;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * The words of a stored HTML value, as one whitespace-normalised string.
 * Markup is dropped rather than parsed: what's compared is what a reader reads,
 * so a re-wrapped paragraph or a changed image width isn't "a change of text".
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/gi, (m) => ENTITIES[m.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of text.toLowerCase().match(TOKEN) ?? []) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return counts;
}

/**
 * How much of `before` is gone from `after`, 0…1.
 *
 * Deliberately one-directional: *adding* text — pasting a long section, filling
 * out a template — is never suspicious, however much of it there is. Only losing
 * what was already written is. A translation scores ~1 (no word survives), a
 * normal edit scores near 0, and clearing the field scores exactly 1.
 */
export function replacedRatio(before: string, after: string): number {
  const a = tokenCounts(before);
  let total = 0;
  for (const n of a.values()) total += n;
  if (total === 0) return 0;

  const b = tokenCounts(after);
  let kept = 0;
  for (const [word, n] of a) kept += Math.min(n, b.get(word) ?? 0);
  return 1 - kept / total;
}

/**
 * Does the page look like a browser translator is running on it?
 *
 * Only ever used to *explain* a blocked save ("your page is translated"), never
 * to decide one — the ratio decides. Each translator leaves its own fingerprint
 * and none of them is contractual, so a miss here costs nothing.
 */
export function isPageTranslated(): boolean {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  // Google Translate stamps the <html> element and wraps every translated text
  // node in a <font>; Edge/Bing tags each translated element with a hash.
  if (root.classList.contains('translated-ltr') || root.classList.contains('translated-rtl')) {
    return true;
  }
  return !!document.querySelector('[_msttexthash], font[style*="vertical-align: inherit"]');
}
