/**
 * A comment body is rich HTML — a mention is a `<span class="rte-mention">`, a
 * line break is a literal `<br>`. Anywhere a body is shown as *text* rather than
 * rendered (the inbox list, a Lark/Telegram webhook), flatten it here; otherwise
 * the markup arrives verbatim and reads as `&nbsp;<br><span class="rte-mention"…`.
 */
export function plainText(html: string): string {
  return decodeEntities(
    (html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** The handful of entities the editor writes. `&amp;` goes last, or `&amp;lt;`
 *  would decode all the way down to `<`. */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * A body as text that keeps its shape — for a reader that needs all of it (an
 * MCP assistant), not a one-line preview. Paragraphs and line breaks survive, a
 * list item reads as "- …", a link keeps its URL, and an image or clip reads as
 * its URL, since a reader that can't see it still needs to know it is there.
 */
export function readableText(html: string): string {
  return decodeEntities(
    (html || '')
      .replace(/<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi, '\n[image: $1]\n')
      .replace(/<video\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi, '\n[video: $1]\n')
      .replace(/<a\b[^>]*?\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
        const shown = label.replace(/<[^>]*>/g, '').trim();
        return !shown || shown === href ? href : `${shown} (${href})`;
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/(p|div|h[1-6]|blockquote|pre|tr|ul|ol|table)>/gi, '\n')
      .replace(/<\/t[dh]>/gi, ' | ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?=- )/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * `plainText` capped to `max` characters, ellipsised when it had to cut. Strip
 * *then* measure: a slice of raw HTML can cut a tag in half, and markup must not
 * spend the budget meant for what the person actually wrote.
 */
export function plainSnippet(html: string, max: number): string {
  const text = plainText(html);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
