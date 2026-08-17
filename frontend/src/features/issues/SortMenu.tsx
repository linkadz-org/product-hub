import { ArrowDownNarrowWide, ArrowUpDown, ArrowUpNarrowWide } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui';
import { t } from '@/i18n';
import type { IssueSortDir, IssueSortField } from './api';
import type { IssueSort } from './useIssueSort';

/** What any list can be ordered by. Mirrors the API's `sort` values, in menu order. */
const SORT_FIELDS = [
  { field: 'id', labelKey: 'sort.fieldId' },
  { field: 'created', labelKey: 'sort.fieldCreated' },
  { field: 'updated', labelKey: 'sort.fieldUpdated' },
] as const;

/**
 * Severity, offered only to a list that can hold bugs (`severity` prop).
 *
 * It ranks the bug scale — low, medium, high, critical — so descending is "worst
 * first", which is the whole reason to reach for it. A task has no severity at
 * all, so on a task board the row would be a control that silently does nothing;
 * it is a separate entry rather than a fourth `SORT_FIELDS` row so that can't
 * happen by omission.
 */
const SEVERITY_FIELD = { field: 'severity', labelKey: 'sort.fieldSeverity' } as const;

/**
 * The radio value that means "no sort" — not an API value, so it never leaves
 * this component. `null` can't be a radio value, and the unsorted state has to be
 * *selectable*, not just the absence of a selection: a list you've sorted needs a
 * way back to the ordering it had when you opened it.
 */
const UNSORTED = 'none';

/**
 * Sort control for the list view — field on top, direction below, in one menu.
 * Built on the same `DropdownMenu` primitive as `FilterMenu` (the Filter control
 * beside it), so the two triggers are the same button and open the same surface;
 * radio items, because both axes are a single choice. The trigger shows the field
 * and an arrow for the direction, so the current ordering is readable without
 * opening it — and on a narrow screen the field word drops away, leaving the icon
 * (the toolbar cluster wraps, so it never pushes anything off the edge).
 *
 * Stateless by design: the ordering lives in the URL (`useIssueSort`), so this is
 * only the control that reads and writes it — a reload or a shared link keeps the
 * list the user was actually looking at.
 *
 * `null` is the honest resting state and reads as such: the trigger says
 * "Sort: Default order" over a neutral two-way arrow, so an unsorted list never
 * claims to be sorted by anything. The direction pair is only shown once a field
 * is chosen — there is no ascending or descending version of "whatever the server
 * returns".
 *
 * Only a list view renders this: a board's order is the drag position, which a
 * sort would silently overwrite (the API drops `order` the moment `sort` is sent).
 * Shared by every issue-backed list (`/issues`, `/tasks`, `/bugs`, the Personal
 * board) — one control, one set of `sort.*` keys, so they all order and read
 * identically. The one variation is the `severity` field, which a bug list opts
 * into (see `SEVERITY_FIELD`); a caller that turns it on must also make sure a
 * severity sort can't outlive the bug rows it was picked for — see how
 * `IssuesPage` drops it when the Kind switch flips to tasks.
 */
export function SortMenu({
  value,
  onChange,
  severity = false,
}: {
  value: IssueSort | null;
  onChange: (next: IssueSort | null) => void;
  /** Offer "Severity" — only true where every row can carry one (a bug list). */
  severity?: boolean;
}) {
  const fields = severity ? [...SORT_FIELDS, SEVERITY_FIELD] : SORT_FIELDS;
  const active = value ? fields.find((f) => f.field === value.field) : undefined;
  const isAsc = value?.dir === 'asc';
  const DirIcon = !value ? ArrowUpDown : isAsc ? ArrowUpNarrowWide : ArrowDownNarrowWide;
  const fieldLabel = active ? t(active.labelKey) : t('sort.fieldDefault');
  // The direction is carried visually by the arrow icon, which is aria-hidden —
  // so it has to be spelled out here, or a screen-reader user cannot tell
  // ascending from descending without opening the menu.
  const dirLabel = value ? `, ${t(isAsc ? 'sort.ascending' : 'sort.descending')}` : '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="gap-1.5"
          aria-label={`${t('sort.title')}: ${fieldLabel}${dirLabel}`}
        >
          <DirIcon className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('sort.title')}:</span>
          <span>{fieldLabel}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t('sort.title')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value?.field ?? UNSORTED}
          onValueChange={(field) =>
            onChange(
              field === UNSORTED
                ? null
                : // Picking a field for the first time has to choose a direction
                  // too; newest-first is what people read a list for.
                  { field: field as IssueSortField, dir: value?.dir ?? 'desc' },
            )
          }
        >
          <DropdownMenuRadioItem value={UNSORTED}>{t('sort.fieldDefault')}</DropdownMenuRadioItem>
          {fields.map((f) => (
            <DropdownMenuRadioItem key={f.field} value={f.field}>
              {t(f.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {value && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={value.dir}
              onValueChange={(dir) => onChange({ ...value, dir: dir as IssueSortDir })}
            >
              <DropdownMenuRadioItem value="asc">{t('sort.ascending')}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="desc">{t('sort.descending')}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
