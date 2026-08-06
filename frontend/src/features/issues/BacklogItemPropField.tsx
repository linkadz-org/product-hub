import { Link } from 'react-router-dom';
import { ArrowUpRight, Map as MapIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Combobox } from '@/components/ui';
import { t } from '@/i18n';
import { useBacklogLink } from '@/features/roadmaps/useBacklogLink';
import { PropField, PropValue } from './IssueDetail';
import { useUpdateIssue } from './api';

interface BacklogItemPropFieldProps {
  issueId: string;
  roadmapId: string;
  roadmapItemId: string;
  roadmapItemLabel: string;
  canWrite: boolean;
}

/**
 * The Properties row linking an issue to the backlog item it delivers.
 *
 * Sits beside the Parent row and is deliberately *not* it: a backlog item isn't
 * an issue (see {@link useBacklogLink}), so it can't be a `parentId` — an issue
 * has a parent issue and a backlog item independently. People reach for the
 * parent picker with an `RM-…` ref, which is why that picker names this field in
 * its empty state.
 *
 * Both kinds get it. A bug carries `roadmapItemId` exactly as a task does — it's
 * what the roadmap's own panel lists under "Bugs" — and until now a bug could be
 * linked only from the roadmap item's side, never from its own page.
 */
export function BacklogItemPropField({
  issueId,
  roadmapId,
  roadmapItemId,
  roadmapItemLabel,
  canWrite,
}: BacklogItemPropFieldProps) {
  const { options, linkFor } = useBacklogLink();
  const update = useUpdateIssue();

  const label = roadmapItemLabel || t('tasks.openRoadmaps');
  // The item's own page, not the board — `findRoadmapItem` resolves ref-or-uuid,
  // so the stored id works as the segment.
  const to = roadmapItemId ? `/roadmaps/${roadmapId}/items/${roadmapItemId}` : `/roadmaps/${roadmapId}`;

  if (!canWrite) {
    return (
      <PropField bare label={t('tasks.backlogItem')}>
        {roadmapId ? (
          <PropValue icon={<MapIcon />}>
            <Link
              to={to}
              className="block truncate font-medium underline-offset-4 hover:underline"
              title={label}
            >
              {label}
            </Link>
          </PropValue>
        ) : (
          <PropValue icon={<MapIcon />} muted>
            {t('tasks.noBacklogItem')}
          </PropValue>
        )}
      </PropField>
    );
  }

  return (
    <PropField bare label={t('tasks.backlogItem')}>
      <div className="flex items-center gap-1">
        <Combobox
          className="min-w-0 flex-1"
          value={roadmapItemId}
          onChange={(id) =>
            update.mutate(
              { id: issueId, input: linkFor(id) },
              {
                onError: (err) =>
                  toast.error(t('common.error'), { description: (err as Error).message }),
              },
            )
          }
          options={options}
          leadingIcon={<MapIcon />}
          placeholder={t('tasks.noBacklogItem')}
          searchPlaceholder={t('tasks.backlogSearch')}
          emptyText={t('relations.empty')}
          disabled={update.isPending}
        />

        {/* Editing costs you the link the read-only row used to be, so it comes
            back as its own control rather than disappearing. */}
        {roadmapId && (
          <Link
            to={to}
            title={label}
            aria-label={label}
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        )}
      </div>
    </PropField>
  );
}
