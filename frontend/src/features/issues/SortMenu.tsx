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

/** What the list can be ordered by. Mirrors the API's `sort` values, in menu order. */
const SORT_FIELDS = [
  { field: 'id', labelKey: 'sort.fieldId' },
  { field: 'created', labelKey: 'sort.fieldCreated' },
  { field: 'updated', labelKey: 'sort.fieldUpdated' },
] as const;

/** The picked ordering — exactly the API's `sort` + `dir` pair. */
export interface IssueSort {
  field: IssueSortField;
  dir: IssueSortDir;
}

/**
 * The radio value that means "no sort" — not an API value, so it never leaves
 * this component. `null` can't be a radio value, and the unsorted state has to be
 * *selectable*, not just the absence of a selection: a list you've sorted needs a
 * way back to the ordering it had when you opened it.
 */
const UNSORTED = 'none';

/**
 * What a list starts on: **nothing**. Sorting is an ability the user reaches for,
 * not a default the page applies for them.
 *
 * This is load-bearing, not a preference. A page is capped at 100 rows with no
 * pagination, and the API's ID sort leads on `refPrefix` — so a default ID sort on
 * a workspace with teams ENG/QC/WEB and 500 issues returns 100 *WEB* issues and
 * nothing else. Sending neither param is what keeps the first screen a slice of
 * the whole workspace, exactly as it was before ID sorting existed.
 */
export const NO_ISSUE_SORT: IssueSort | null = null;

/**
 * Sort control for the list view — field on top, direction below, in one menu.
 * Built on the same `DropdownMenu` primitive as `FilterMenu` (the Filter control
 * beside it), so the two triggers are the same button and open the same surface;
 * radio items, because both axes are a single choice. The trigger shows the field
 * and an arrow for the direction, so the current ordering is readable without
 * opening it — and on a narrow screen the field word drops away, leaving the icon
 * (the toolbar cluster wraps, so it never pushes anything off the edge).
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
 * identically.
 */
export function SortMenu({
  value,
  onChange,
}: {
  value: IssueSort | null;
  onChange: (next: IssueSort | null) => void;
}) {
  const active = value ? SORT_FIELDS.find((f) => f.field === value.field) : undefined;
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
          {SORT_FIELDS.map((f) => (
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
