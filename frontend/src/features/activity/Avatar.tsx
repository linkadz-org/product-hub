import { cn } from '@/lib/utils';

/**
 * Initial-in-a-circle avatar used across the activity timeline (comments,
 * system-event rows, headers). Its own file rather than living inside
 * `CommentThread.tsx`: `ActivityEntry.tsx` (system-event rows) needs it too,
 * and `CommentThread.tsx` already imports `ActivityEntry` to interleave
 * comments with events — importing `Avatar` back from `CommentThread` would
 * make that a cycle.
 */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground',
        className,
      )}
      aria-hidden
    >
      {(name || '?').charAt(0).toUpperCase()}
    </span>
  );
}
