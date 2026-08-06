import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CornerDownRight, Search } from 'lucide-react';
import { Button, Checkbox, Dialog, Input, Spinner } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { IssueKind } from '@/types/enums';
import { subtreeIds, toIssueTree, useIssueDescendants } from './issueTree';

/** A backlog item's ref — the one thing people search for here that is, by
 *  design, never an issue. */
const BACKLOG_REF = /^RM-/i;

export interface PickerIssue {
  id: string;
  kind: IssueKind;
  shortId: string;
  title: string;
  parentId: string;
  status: string;
  roadmapItemId: string;
  roadmapItemLabel: string;
}

/**
 * What comes back per picked row. `parentId` rides along because a host that
 * writes `parentId` must **not** re-root an issue whose own parent was picked
 * too — doing that would flatten the subtree it just chose to keep.
 */
export interface PickedIssue {
  id: string;
  parentId: string;
}

interface PickIssueDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Scope the search to one kind (e.g. sub-tasks are tasks only). Omit to search
   * **both** kinds — a cross-type relation can link a task to a bug and back.
   */
  kind?: IssueKind;
  /** Ids to hide (at least the source issue itself). */
  excludeIds: string[];
  /** Dialog title — the relation label, e.g. "Blocked by". */
  title: string;
  /**
   * Pick several rows and confirm with a button, instead of one click closing the
   * dialog. Off for a typed relation (one target each); on wherever you're filling
   * a list of children.
   */
  multiple?: boolean;
  /** Extra per-row filter the host owns, e.g. "already on this backlog item". */
  filter?: (issue: PickerIssue) => boolean;
  /** Leading slot on a row — the roadmap's status dot. */
  renderLead?: (issue: PickerIssue) => ReactNode;
  /** Second line under the title — e.g. which backlog item it sits on today. */
  renderMeta?: (issue: PickerIssue) => ReactNode;
  /** Trailing slot, right of the ref — the roadmap's status label. */
  renderTrail?: (issue: PickerIssue) => ReactNode;
  /** Sits under the list; for the "linking moves it" kind of warning. */
  hint?: ReactNode;
  onPick: (picked: PickedIssue[]) => void;
  pending?: boolean;
}

/**
 * Pick existing issues to link. Search runs server-side over title, description
 * and shortId, so pasting a TSK-5 / BUG-12 resolves straight to it. With no `kind`
 * the search spans both collections (cross-type links), and bug rows get a badge so
 * the two kinds read apart; pass `kind` to scope it (sub-tasks are tasks only).
 *
 * **A match brings its subtree with it.** Search returns loose rows, but work isn't
 * shaped that way: linking a parent on its own left its children behind on whatever
 * they hung off before, and you had to already know they existed to go find them.
 * So each match's descendants are fetched and drawn nested beneath it — including
 * ones the search text never matched — and ticking a parent ticks the whole family.
 * Untick any of them if you want only part of it; the parent then shows the
 * indeterminate dash rather than pretending it's fully selected.
 */
export function PickIssueDialog({
  open,
  onClose,
  kind,
  excludeIds,
  title,
  multiple = false,
  filter,
  renderLead,
  renderMeta,
  renderTrail,
  hint,
  onPick,
  pending,
}: PickIssueDialogProps) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSelected(new Set());
    }
  }, [open]);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data, isLoading } = useQuery({
    queryKey: ['issue-picker', kind ?? 'all', search],
    queryFn: () =>
      apiGet<{ items: PickerIssue[] }>('/issues', {
        ...(kind ? { kind } : {}),
        limit: 20,
        ...(search ? { search } : {}),
      }),
    enabled: open,
  });

  const matches = useMemo(() => data?.items ?? [], [data]);
  // Everything under the matches, so a subtree is visible *before* you commit to it.
  const { data: descendants } = useIssueDescendants<PickerIssue>(
    matches.map((it) => it.id),
    open,
  );

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);
  const rows = useMemo(() => {
    // A descendant can be a match in its own right — de-dupe before nesting.
    const byId = new Map<string, PickerIssue>();
    for (const issue of [...matches, ...(descendants?.items ?? [])]) {
      if (exclude.has(issue.id)) continue;
      if (filter && !filter(issue)) continue;
      byId.set(issue.id, issue);
    }
    return toIssueTree([...byId.values()]);
  }, [matches, descendants, exclude, filter]);

  const issues = useMemo(() => rows.map((r) => r.issue), [rows]);

  /** Tick/untick a row **and its subtree** — the children come along, so the
   *  checkbox has to say so up front rather than surprise you after linking. */
  function toggle(id: string) {
    setSelected((prev) => {
      const family = subtreeIds(issues, id);
      const next = new Set(prev);
      if (prev.has(id)) family.forEach((memberId) => next.delete(memberId));
      else family.forEach((memberId) => next.add(memberId));
      return next;
    });
  }

  /** Some-but-not-all of the subtree picked — the dash, not a tick. */
  function isPartial(id: string): boolean {
    if (selected.has(id)) return false;
    const family = subtreeIds(issues, id);
    family.delete(id);
    return [...family].some((memberId) => selected.has(memberId));
  }

  function confirm() {
    // Tree order, so a host writing parents applies them top-down.
    const picked = issues.filter((it) => selected.has(it.id));
    if (picked.length) onPick(picked.map(({ id, parentId }) => ({ id, parentId })));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      className="max-w-xl"
      footer={
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {multiple && (
            <Button type="button" onClick={confirm} disabled={pending || selected.size === 0}>
              {t('relations.linkCount').replace('{count}', String(selected.size))}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('relations.search')}
            aria-label={t('relations.search')}
            className="pl-9"
            autoFocus
          />
        </div>

        <div className="max-h-[50vh] min-h-32 overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {/* Typing an `RM-…` ref here is a fair mistake — it's a ref like any
                  other, but a backlog item isn't an issue, so no issue picker can
                  ever match one. Name the field that does instead of going blank. */}
              {BACKLOG_REF.test(search.trim())
                ? t('relations.backlogRef')
                : search
                  ? t('relations.empty')
                  : t('relations.none')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rows.map(({ issue: it, depth }) => {
                const checked = selected.has(it.id);
                const body = (
                  <>
                    {/* Depth is drawn, not only indented — at a glance you can tell
                        this row is coming along with the one above it. */}
                    {depth > 0 && (
                      <CornerDownRight
                        className="size-3.5 shrink-0 text-muted-foreground/60"
                        aria-hidden
                      />
                    )}
                    {renderLead?.(it)}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        {it.kind === IssueKind.BUG && (
                          <span className="shrink-0 rounded border border-border bg-muted/50 px-1 py-px text-[10px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
                            {t('relations.kindBug')}
                          </span>
                        )}
                        <span className="min-w-0 truncate text-sm">{it.title}</span>
                      </span>
                      {renderMeta && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {renderMeta(it)}
                        </span>
                      )}
                    </span>
                    <span
                      className="shrink-0 font-mono text-[11px] text-muted-foreground"
                      title={it.shortId || it.id}
                    >
                      {it.shortId || it.id.slice(0, 8)}
                    </span>
                    {renderTrail?.(it)}
                  </>
                );

                return (
                  <li key={it.id} style={{ marginInlineStart: depth * 18 }}>
                    {multiple ? (
                      // The whole row is the label, so the hit target is the row
                      // and not a 16px box.
                      <label className={rowClass(checked, pending)}>
                        <Checkbox
                          checked={checked ? true : isPartial(it.id) ? 'indeterminate' : false}
                          onCheckedChange={() => toggle(it.id)}
                          disabled={pending}
                          aria-label={it.title}
                        />
                        {body}
                      </label>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPick([{ id: it.id, parentId: it.parentId }])}
                        disabled={pending}
                        className={rowClass(false, pending)}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </Dialog>
  );
}

/** One row's chrome, shared so the tick and click-to-pick variants can't drift. */
function rowClass(checked: boolean, pending?: boolean): string {
  return cn(
    'flex w-full cursor-pointer items-center gap-2.5 rounded-md border bg-background px-2.5 py-2 text-left transition-colors hover:border-primary hover:bg-accent',
    checked ? 'border-primary bg-accent/60' : 'border-border',
    pending && 'pointer-events-none opacity-50',
  );
}
