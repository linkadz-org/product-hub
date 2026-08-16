import { RoadmapItemData } from './types/roadmap-item.type';

/**
 * Fields whose changes become history rows.
 *
 * Deliberately a fixed, explicit list rather than a walk over every property —
 * see `issue-diff.ts` for the same rationale. `phase` (NOT `column`) is the
 * value stored on the item: `RoadmapColumn` is the board's column
 * *configuration* (`key`/`label`/`color`), `phase` is the item's own field,
 * matching `column.key`.
 */
export const TRACKED_FIELDS = ['title', 'phase', 'assignees'] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/**
 * Fields recorded as "changed" with no values shown.
 *
 * `title` lands here for roadmap items — unlike the issue and doc-page paths,
 * where a rename's values are promoted to the event itself. The row already
 * carries `itemRef` (the item's `RM-…` shortId), which is what a reader uses
 * to find the item; the row's job here is to say a rename happened, not to
 * replay the wording, so it stays grouped with the other value-less fields
 * rather than costing the log the italic diff the entity+long-text callout in
 * `issue-diff.ts` argues against duplicating for a same-shaped rename.
 */
export const LONG_TEXT_FIELDS: readonly string[] = ['title'];

/**
 * Bare-id fields with no display form. None today — `phase` already reads as
 * a plain string and `assignees` renders names — but kept as a named,
 * separate set (rather than folded into `LONG_TEXT_FIELDS`) so the two kinds
 * of value-less field stay distinguishable, matching `issue-diff.ts` /
 * `doc-page-diff.ts`.
 */
export const NO_VALUE_FIELDS: readonly string[] = [];

export interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

/** One item's changes within a single roadmap write. */
export interface ItemChange {
  itemId: string;
  /** The item's own ref (`RM-…`), never the roadmap's. */
  itemRef: string;
  changes: FieldChange[];
}

/** Render one tracked field as the flat string the log stores. */
function read(item: RoadmapItemData, field: TrackedField): string {
  switch (field) {
    case 'assignees':
      return (item.assignees ?? []).map((a) => a.name).join(', ');
    default:
      return String((item as unknown as Record<string, unknown>)[field] ?? '');
  }
}

function refOf(item: RoadmapItemData): string {
  return item.shortId || item.id;
}

/**
 * Diff two snapshots of a roadmap's embedded `items` array.
 *
 * Both `before` and `after` are the WHOLE array, not one item, because a
 * single drag-to-reorder rewrites it wholesale. Items are paired by `id`
 * (never by array position — a reorder changes position for every item
 * without changing any of them), then compared field by field:
 *
 *  - an id present only in `after` is reported as `created`
 *  - an id present only in `before` is reported as `deleted`
 *  - an id present in both is compared field by field; no changed field means
 *    no row at all, which is what makes a pure reorder emit nothing.
 */
export function diffRoadmapItems(
  before: RoadmapItemData[],
  after: RoadmapItemData[],
): ItemChange[] {
  const beforeById = new Map(before.map((i) => [i.id, i]));
  const afterById = new Map(after.map((i) => [i.id, i]));
  const result: ItemChange[] = [];

  for (const [id, item] of afterById) {
    if (beforeById.has(id)) continue;
    result.push({
      itemId: id,
      itemRef: refOf(item),
      changes: [{ field: 'created', oldValue: '', newValue: '' }],
    });
  }

  for (const [id, item] of beforeById) {
    if (afterById.has(id)) continue;
    result.push({
      itemId: id,
      itemRef: refOf(item),
      changes: [{ field: 'deleted', oldValue: '', newValue: '' }],
    });
  }

  for (const [id, afterItem] of afterById) {
    const beforeItem = beforeById.get(id);
    if (!beforeItem) continue; // handled as "created" above

    const changes: FieldChange[] = [];
    for (const field of TRACKED_FIELDS) {
      const prevVal = read(beforeItem, field);
      const nowVal = read(afterItem, field);
      if (prevVal === nowVal) continue;
      const noValue = LONG_TEXT_FIELDS.includes(field) || NO_VALUE_FIELDS.includes(field);
      changes.push({
        field,
        oldValue: noValue ? '' : prevVal,
        newValue: noValue ? '' : nowVal,
      });
    }
    if (changes.length) {
      result.push({ itemId: id, itemRef: refOf(afterItem), changes });
    }
  }

  return result;
}
