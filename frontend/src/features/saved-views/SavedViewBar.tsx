import { useState, type FormEvent } from 'react';
import { Button, Dialog, Field, Input, Label, Switch } from '@/components/ui';
import { t } from '@/i18n';
import type { FilterSelections } from '@/components/FilterMenu';
import type { IssueSort } from '@/features/issues/SortMenu';
import type { SavedViewDto } from '@/types/dto';
import type { IssueKind } from '@/types/enums';
import { buildSavedViewQuery, useCreateSavedView, useUpdateSavedView } from './api';

interface SavedViewBarProps {
  kind: IssueKind;
  view: 'board' | 'list' | 'timeline';
  filters: FilterSelections;
  sort: IssueSort | null;
  search: string;
  /** The saved view currently open (from `?sv=`), if any. */
  activeView: SavedViewDto | undefined;
  /** Called with the new/updated view's id once a save completes, so the
   *  caller can point `?sv=` at it. */
  onSaved: (id: string) => void;
}

/**
 * The board toolbar's save control. No view open → one "Save current view"
 * button. A view open and unchanged → nothing (the URL already names it).
 * A view open and changed → a "Modified" label plus "Save" (overwrite the
 * open view) and "Save as new" (keep the original, create another).
 *
 * Change detection is a plain `JSON.stringify` of the five board-state
 * fields — the same shape `buildSavedViewQuery` returns and the API stores,
 * so there's no separate diffing logic to drift from either.
 */
export function SavedViewBar({ kind, view, filters, sort, search, activeView, onSaved }: SavedViewBarProps) {
  const create = useCreateSavedView();
  const update = useUpdateSavedView();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);

  const query = buildSavedViewQuery({ kind, view, filters, sort, search });
  const modified =
    !!activeView &&
    JSON.stringify(query) !==
      JSON.stringify({
        kind: activeView.kind,
        view: activeView.view,
        filters: activeView.filters,
        sort: activeView.sort,
        search: activeView.search,
      });

  function openDialog() {
    setName(activeView ? `${activeView.name} 2` : '');
    setShared(activeView?.shared ?? false);
    setDialogOpen(true);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, shared, query },
      {
        onSuccess: (created) => {
          setDialogOpen(false);
          setName('');
          onSaved(created.id);
        },
      },
    );
  }

  function overwrite() {
    if (!activeView) return;
    update.mutate({ id: activeView.id, input: { query } });
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {activeView ? (
          modified && (
            <>
              <span className="text-xs text-muted-foreground">{t('savedViews.modified')}</span>
              <Button size="sm" variant="outline" onClick={overwrite} loading={update.isPending}>
                {t('savedViews.save')}
              </Button>
              <Button size="sm" variant="outline" onClick={openDialog}>
                {t('savedViews.saveAsNew')}
              </Button>
            </>
          )
        ) : (
          <Button size="sm" variant="outline" onClick={openDialog}>
            {t('savedViews.saveCurrent')}
          </Button>
        )}
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={t('savedViews.saveCurrent')}
        footer={
          <>
            <Button variant="ghost" type="button" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button form="sv-create" type="submit" loading={create.isPending}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form id="sv-create" onSubmit={submit} className="grid gap-4">
          <Field label={t('savedViews.name')} htmlFor="sv-name">
            <Input id="sv-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <div className="flex items-start gap-3">
            <Switch id="sv-shared" className="mt-0.5" checked={shared} onCheckedChange={setShared} />
            <div className="grid gap-0.5">
              <Label htmlFor="sv-shared" className="cursor-pointer">
                {t('savedViews.share')}
              </Label>
              <span className="text-sm text-muted-foreground">{t('savedViews.shareHint')}</span>
            </div>
          </div>
        </form>
      </Dialog>
    </>
  );
}
