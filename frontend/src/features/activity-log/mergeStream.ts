import type { CommentDto } from '@/types/dto';
import type { ActivityEntry } from './entryText';

/** A comment, tagged so a merged stream can tell it apart from a system event. */
export type StreamComment = CommentDto & { kind: 'comment' };

/** A system event, tagged the same way. */
export type StreamEvent = ActivityEntry & { kind: 'event' };

export type StreamItem = StreamComment | StreamEvent;

/**
 * Interleave comments and system events into one chronological stream, oldest
 * first — the order the Activity section reads top to bottom in. Pure and
 * dependency-free (no React) so it's testable without `@testing-library/react`,
 * which this repo doesn't have.
 *
 * Either list may be `undefined` — `useActivity`/`useComments` are `undefined`
 * while loading and (for history) on error, and this must degrade to "just
 * render the other list" rather than throw.
 */
export function mergeStream(
  comments: CommentDto[] | undefined,
  entries: ActivityEntry[] | undefined,
): StreamItem[] {
  const tagged: StreamItem[] = [
    ...(comments ?? []).map((c): StreamComment => ({ ...c, kind: 'comment' })),
    ...(entries ?? []).map((e): StreamEvent => ({ ...e, kind: 'event' })),
  ];
  return tagged.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}
