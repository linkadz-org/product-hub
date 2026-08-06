import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { t } from '@/i18n';
import { PickIssueDialog } from './PickIssueDialog';
import { useIssueDescendants } from './issueTree';
import { useUpdateIssue } from './api';

/**
 * Choosing an issue's **own** parent — the picker, the cycle exclusion and the
 * write, kept out of {@link ParentPropField} so that stays a row of markup. A
 * second surface offering the action (the breadcrumb briefly did) hangs off
 * this rather than repeating any of it.
 *
 * The picker spans **both kinds** — a bug found while doing TSK-5 belongs under
 * TSK-5, and a bug nests under a bug just as well — and hides this issue's own
 * subtree, since a parent from below is exactly what makes a cycle. (The API
 * refuses one too; this just stops it being offered.) Descendants are fetched
 * only while the dialog is open, so merely opening an issue costs nothing.
 */
export function useParentPicker(issueId: string): {
  openPicker: () => void;
  /** Render anywhere — it portals, so it adds no box to whatever it sits in. */
  dialog: ReactNode;
  setParent: (parentId: string) => void;
  pending: boolean;
} {
  const [open, setOpen] = useState(false);
  const update = useUpdateIssue();
  const { data: below } = useIssueDescendants<{ id: string; parentId: string }>(
    [issueId],
    open && !!issueId,
  );

  function setParent(parentId: string) {
    update.mutate(
      { id: issueId, input: { parentId } },
      {
        onSuccess: () => setOpen(false),
        // The API's cycle guard rejects here ("That issue is already below this
        // one"). Say so — silence would read as a no-op that quietly worked.
        onError: (err) => toast.error(t('common.error'), { description: (err as Error).message }),
      },
    );
  }

  return {
    openPicker: () => setOpen(true),
    setParent,
    pending: update.isPending,
    dialog: open ? (
      <PickIssueDialog
        open={open}
        onClose={() => setOpen(false)}
        excludeIds={[issueId, ...(below?.items ?? []).map((it) => it.id)]}
        title={t('issues.parentPick')}
        onPick={([picked]) => picked && setParent(picked.id)}
        pending={update.isPending}
      />
    ) : null,
  };
}
