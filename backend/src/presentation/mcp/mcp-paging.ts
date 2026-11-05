/**
 * Splitting a long tool reply into pages instead of cutting it short.
 *
 * Reads used to clip — 20 subtasks, the last 100 comments, 1,000 characters of
 * each — so an assistant quietly worked from part of the record. Now a reply
 * carries everything, and the only ceiling left is the client's: Claude Code
 * refuses a tool result past ~25k tokens. A reply longer than one page is cut at
 * line boundaries and the caller asks for the next page, so nothing is ever lost.
 */

/** One page of reply text. ~40k characters stays under Claude Code's 25k-token
 *  tool-result ceiling even for Vietnamese and URL-heavy text, which tokenise
 *  far worse than English. */
export const PAGE_CHARS = 40_000;

/** `body` cut into pages of at most `size` characters, breaking between lines. */
export function paginate(body: string, size = PAGE_CHARS): string[] {
  if (body.length <= size) return [body];
  const pages: string[] = [];
  let current = '';
  const flush = (): void => {
    if (current) pages.push(current);
    current = '';
  };
  for (const line of body.split('\n')) {
    // A single line longer than a page (a huge pasted log) is split by length —
    // the only way it fits at all.
    for (let start = 0; start < line.length || start === 0; start += size) {
      const piece = line.slice(start, start + size);
      const joined = current ? `${current}\n${piece}` : piece;
      if (joined.length > size) {
        flush();
        current = piece;
      } else {
        current = joined;
      }
      if (line.length <= size) break;
    }
  }
  flush();
  return pages;
}

/**
 * The requested page of a reply, footed with where it sits and how to get the
 * rest. A one-page reply comes back untouched, so short answers read as before.
 */
export function pageOf(body: string, tool: string, page = 1, size = PAGE_CHARS): string {
  const pages = paginate(body, size);
  if (pages.length === 1 && page <= 1) return body;
  if (page < 1 || page > pages.length) {
    return `There is no page ${page} — this reply has ${pages.length} page(s).`;
  }
  const footer =
    page < pages.length
      ? `— Page ${page} of ${pages.length}. Call ${tool} again with page: ${page + 1} for the rest. —`
      : `— Page ${page} of ${pages.length} (end). —`;
  return `${pages[page - 1]}\n\n${footer}`;
}
