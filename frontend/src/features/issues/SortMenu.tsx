import { ArrowDownNarrowWide, ArrowUpNarrowWide } from 'lucide-react';
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

/** What every list view starts on: newest ticket first, which is what people read
 *  a list for. Shared so the three boards can't drift apart on their default. */
export const DEFAULT_ISSUE_SORT: IssueSort = { field: 'id', dir: 'desc' };

/**
 * Sort control for the list view — field on top, direction below, in one menu.
 * Built on the same `DropdownMenu` primitive as `FilterMenu` (the Filter control
 * beside it), so the two triggers are the same button and open the same surface;
 * radio items, because both axes are a single choice. The trigger shows the field
 * and an arrow for the direction, so the current ordering is readable without
 * opening it — and on a narrow screen the field word drops away, leaving the icon
 * (the toolbar cluster wraps, so it never pushes anything off the edge).
 *
 * Only a list view renders this: a board's order is the drag position, which a
 * sort would silently overwrite (the API drops `order` the moment `sort` is sent).
 * Shared by every issue-backed board (`/issues`, `/tasks`, `/bugs`) — one control,
 * one set of `sort.*` keys, so all three lists order and read identically.
 */
export function SortMenu({
  value,
  onChange,
}: {
  value: IssueSort;
  onChange: (next: IssueSort) => void;
}) {
  const active = SORT_FIELDS.find((f) => f.field === value.field) ?? SORT_FIELDS[0];
  const DirIcon = value.dir === 'asc' ? ArrowUpNarrowWide : ArrowDownNarrowWide;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="gap-1.5"
          aria-label={`${t('sort.title')}: ${t(active.labelKey)}`}
        >
          <DirIcon className="size-3.5" aria-hidden />
          <span className="hidden sm:inline">{t('sort.title')}:</span>
          <span>{t(active.labelKey)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>{t('sort.title')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value.field}
          onValueChange={(field) => onChange({ ...value, field: field as IssueSort['field'] })}
        >
          {SORT_FIELDS.map((f) => (
            <DropdownMenuRadioItem key={f.field} value={f.field}>
              {t(f.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={value.dir}
          onValueChange={(dir) => onChange({ ...value, dir: dir as IssueSort['dir'] })}
        >
          <DropdownMenuRadioItem value="asc">{t('sort.ascending')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desc">{t('sort.descending')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
