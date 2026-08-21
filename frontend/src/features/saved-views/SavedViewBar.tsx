import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, Trash2, Users } from 'lucide-react';
import {
  Button,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  Label,
  Switch,
} from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import type { FilterSelections } from '@/components/FilterMenu';
import type { IssueSort } from '@/features/issues/useIssueSort';
import type { SavedViewDto } from '@/types/dto';
import type { IssueKind } from '@/types/enums';
import {
  buildSavedViewQuery,
  useCreateSavedView,
  useDeleteSavedView,
  useUpdateSavedView,
} from './api';
import { groupSavedViews, savedViewHref } from './scope';

interface SavedViewBarProps {
  kind: IssueKind;
  view: 'board' | 'list' | 'timeline';
  filters: FilterSelections;
  sort: IssueSort | null;
  search: string;
  /** This board's scope key — what a view saved here carries, so it reopens
   *  on this board rather than the workspace one. See `scope.ts`. */
  scope: string;
  /** Every view visible to this user (own + shared), from `useSavedViews`. */
  views: SavedViewDto[] | undefined;
  /** The saved view currently open (from `?sv=`), if any. */
  activeView: SavedViewDto | undefined;
  /** Called with the new/updated view's id once a save completes, so the
   *  caller can point `?sv=` at it. */
  onSaved: (id: string) => void;
}

/**
 * The board toolbar's saved-view control: a picker, then the save actions.
 *
 * **Picker.** Two lists, not one — "My views" and "Shared with me". The API
 * already returns them together, mine first (`sortSavedViews`), but they aren't
 * the same object to a user: mine are mine to rename and delete, theirs belong
 * to someone else and can change under me. One flat list hid that, and hid
 * which of them I could actually manage. Views from *every* board are listed:
 * picking one navigates to the board it was saved on, so the picker doubles as
 * "where was that filter I made last week?".
 *
 * **Save.** No view open → one "Save view" button. A view open and unchanged →
 * nothing (the URL already names it). A view open and changed → a "Modified"
 * label plus "Save" (overwrite the open view) and "Save as new" (keep the
 * original, create another).
 *
 * Change detection is a plain `JSON.stringify` of the five board-state fields —
 * the same shape `buildSavedViewQuery` returns and the API stores, so there's
 * no separate diffing logic to drift from either.
 */
export function SavedViewBar({
  kind,
  view,
  filters,
  sort,
  search,
  scope,
  views,
  activeView,
  onSaved,
}: SavedViewBarProps) {
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
      { name: trimmed, shared, scope, query },
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
        <SavedViewPicker views={views} activeView={activeView} />
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

/**
 * The picker itself. Kept in this file rather than its own because it only ever
 * appears beside the save actions and shares their state — splitting it would
 * mean threading `views`/`activeView` through two components for no gain.
 *
 * Rows navigate by `<a href>` (`savedViewHref`) rather than an onClick, so a
 * view can be ⌘-clicked into a new tab and its URL copied — it *is* a place.
 */
function SavedViewPicker({
  views,
  activeView,
}: {
  views: SavedViewDto[] | undefined;
  activeView: SavedViewDto | undefined;
}) {
  const { user } = useAuth();
  const { mine, shared } = groupSavedViews(views, user?.id);
  // Nothing saved anywhere yet: the trigger would open an empty menu, so the
  // bare "Save view" button beside it is the whole control until there is.
  if (mine.length === 0 && shared.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-[14rem] gap-1.5">
          <Icon name={(activeView?.icon || 'checks') as IconName} size={14} />
          <span className="min-w-0 flex-1 truncate">
            {activeView?.name ?? t('savedViews.pick')}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-y-auto">
        <SavedViewGroup label={t('savedViews.mine')} views={mine} activeId={activeView?.id} owned />
        {mine.length > 0 && shared.length > 0 && <DropdownMenuSeparator />}
        <SavedViewGroup label={t('savedViews.shared')} views={shared} activeId={activeView?.id} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One labelled group of the picker. Renders nothing when empty, so a user with
 *  no shared views sees no "Shared with me" heading over a void. */
function SavedViewGroup({
  label,
  views,
  activeId,
  owned,
}: {
  label: string;
  views: SavedViewDto[];
  activeId: string | undefined;
  /** Mine — gets the delete action. Mirrors the backend's owner-or-admin gate;
   *  an admin deletes someone else's from the sidebar row, which already offers
   *  it, rather than from a picker where it reads as deleting *my* view. */
  owned?: boolean;
}) {
  const remove = useDeleteSavedView();
  if (views.length === 0) return null;

  return (
    <>
      <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </DropdownMenuLabel>
      {views.map((v) => {
        const active = v.id === activeId;
        return (
          <DropdownMenuItem key={v.id} asChild className="group/sv pr-8">
            <Link to={savedViewHref(v)}>
              <Icon name={(v.icon || 'checks') as IconName} size={14} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">{v.name}</span>
              {v.shared && (
                <Users
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label={t('savedViews.sharedBadge')}
                />
              )}
              {active && <Check className="absolute right-2 size-4" aria-hidden />}
              {owned && !active && (
                <button
                  type="button"
                  aria-label={t('savedViews.delete')}
                  title={t('savedViews.delete')}
                  onClick={(e) => {
                    // The row is a link; deleting must not follow it.
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm(t('savedViews.confirmDelete'))) remove.mutate(v.id);
                  }}
                  className={cn(
                    'absolute right-1.5 grid size-6 place-items-center rounded-md opacity-0 transition-opacity',
                    'hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100',
                    'group-hover/sv:opacity-100',
                  )}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </Link>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
