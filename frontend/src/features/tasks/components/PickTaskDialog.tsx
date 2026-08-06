import { t } from '@/i18n';
import { taskStatusColor, taskStatusLabel } from '@/types/enums';
import { PickIssueDialog, type PickedIssue, type PickerIssue } from '@/features/issues/PickIssueDialog';
import { useUpdateIssue } from '@/features/issues/api';

/** Nothing is off-limits by id here — the "already on this item" rule is a
 *  `filter`. Hoisted so it keeps one identity across renders. */
const NOTHING_EXCLUDED: string[] = [];

interface PickTaskDialogProps {
  open: boolean;
  onClose: () => void;
  /** The backlog item (roadmap item) the picked issues get linked to. */
  roadmapId: string;
  projectId: string;
  itemId: string;
  /** Denormalized label stored on the issue, e.g. "Now · Passkey login". */
  itemLabel: string;
}

/**
 * Pick existing **tasks or bugs** and link them to a backlog item. Reads the
 * unified `/issues` collection, so both kinds are candidates (a bug can block a
 * roadmap item just as a task delivers it).
 *
 * This is the roadmap's wording and write wrapped around the shared
 * {@link PickIssueDialog} — it used to be a near-copy of it, which is how the two
 * drifted: multi-select and the nested subtree would otherwise have to be built
 * twice. The only roadmap-specific parts left are the status dot/label, the
 * "linked to X" line, the move warning, and the `roadmapItemId` write.
 *
 * Every picked row is stamped, descendants included: linking a parent to a
 * backlog item and leaving its children pointing at the old one is what makes a
 * backlog item's progress lie.
 */
export function PickTaskDialog({
  open,
  onClose,
  roadmapId,
  projectId,
  itemId,
  itemLabel,
}: PickTaskDialogProps) {
  const link = useUpdateIssue();

  async function pick(picked: PickedIssue[]) {
    if (link.isPending) return;
    const input = { roadmapId, roadmapItemId: itemId, roadmapItemLabel: itemLabel, projectId };
    try {
      // Sequential, so a mid-way failure leaves a prefix linked rather than an
      // unpredictable subset — and the error names the first one that broke.
      for (const { id } of picked) await link.mutateAsync({ id, input });
      onClose();
    } catch {
      // Stay open with the error in the hint line, so the picks aren't lost.
    }
  }

  return (
    <PickIssueDialog
      open={open}
      onClose={onClose}
      title={t('tasks.pickTitle')}
      excludeIds={NOTHING_EXCLUDED}
      multiple
      // Issues already sitting on this item aren't pickable.
      filter={(iss: PickerIssue) => iss.roadmapItemId !== itemId}
      renderLead={(iss) => (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: taskStatusColor(iss.status) }}
          aria-hidden
        />
      )}
      renderMeta={(iss) =>
        iss.roadmapItemLabel
          ? t('tasks.pickLinkedTo').replace('{item}', iss.roadmapItemLabel)
          : t('tasks.pickUnlinked')
      }
      renderTrail={(iss) => (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          {taskStatusLabel(iss.status)}
        </span>
      )}
      hint={
        link.isError ? (
          <span className="text-destructive">{link.error.message}</span>
        ) : (
          t('tasks.pickMoveHint')
        )
      }
      onPick={pick}
      pending={link.isPending}
    />
  );
}
