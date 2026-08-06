import { CornerLeftUp, X } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { PropField } from './IssueDetail';
import { useParentPicker } from './useParentPicker';

interface ParentPropFieldProps {
  /** The issue whose parent this is — the one being re-parented. */
  issueId: string;
  parentId: string;
  /** Denormalized from `GET /issues/:id`; `''` when top-level or unreadable. */
  parentShortId: string;
  parentTitle: string;
  canWrite: boolean;
}

/**
 * The Properties row that sets an issue's **own** parent.
 *
 * The gap this closes: hierarchy could only ever be created *downwards* — from a
 * parent's Sub-tasks panel, or through MCP. Standing on a child there was no way
 * to say "this belongs under that", even though the breadcrumb would happily
 * render it once some other screen had set it. So an issue you'd just created
 * could not be filed anywhere from the page you were already on.
 *
 * Deliberately not a link to the parent: the breadcrumb above already is one.
 * This row is the **full** editor (set / change / clear) — the breadcrumb's empty
 * slot only covers setting the first one, and vanishes once it's filled. Detail
 * surfaces with no page header at all (the peek drawer, Inbox) have this and
 * nothing else, which is why it owns its own picker rather than taking one down.
 */
export function ParentPropField({
  issueId,
  parentId,
  parentShortId,
  parentTitle,
  canWrite,
}: ParentPropFieldProps) {
  const { openPicker, dialog, setParent, pending } = useParentPicker(issueId);

  const label = parentShortId ? `${parentShortId} · ${parentTitle}` : '';

  return (
    <>
      <PropField bare label={t('subtasks.parent')}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => canWrite && openPicker()}
            disabled={!canWrite}
            className={cn(
              'flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-3 text-left text-sm transition-colors',
              canWrite && 'border border-input bg-transparent hover:bg-accent',
              !label && 'text-muted-foreground',
            )}
            title={label || t('issues.parentSet')}
          >
            <span className="grid size-4 shrink-0 place-items-center text-muted-foreground/70">
              <CornerLeftUp className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">
              {/* A parent that exists but can't be read comes back with an empty
                  shortId — say "set one", not a blank row that looks broken. */}
              {label || (canWrite ? t('issues.parentSet') : t('subtasks.parentNone'))}
            </span>
          </button>

          {canWrite && parentId && (
            <button
              type="button"
              onClick={() => setParent('')}
              disabled={pending}
              className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
              aria-label={t('issues.parentClear')}
              title={t('issues.parentClear')}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </PropField>

      {/* Outside the field: a Radix dialog portals to the body, so it adds no cell
          to the sidebar's grid and can't be swallowed by the row's tooltip. */}
      {dialog}
    </>
  );
}
