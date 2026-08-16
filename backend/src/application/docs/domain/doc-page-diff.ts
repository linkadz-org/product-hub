import { DocPageEntity } from './entities/doc-page.entity';

/**
 * Fields whose changes become history rows.
 *
 * Deliberately a fixed, explicit list rather than a walk over every property —
 * see `issue-diff.ts` for the same rationale. `content` is NEVER tracked here:
 * the collab server writes it continuously during a typing session, and
 * `doc-page-version` already keeps deliberate snapshots of it. A row per save
 * would be noise, not history.
 */
export const TRACKED_FIELDS = ['title', 'parentId', 'order'] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/**
 * Fields recorded as "changed" with no values shown.
 *
 * `parentId` is a bare id with no display form on the page itself — the event
 * (the page moved) is worth recording, but a raw uuid is not worth showing,
 * and resolving it to the new parent's title would require a repository
 * lookup in this module, which is deliberately pure (no I/O). Same reasoning
 * as `cycleId`/`parentId`/`projectId` in `issue-diff.ts`.
 */
export const NO_VALUE_FIELDS: readonly string[] = ['parentId'];

export interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

export type DocPageSnapshot = Record<TrackedField, string>;

/** Render one tracked field as the flat string the log stores. */
function read(page: DocPageEntity, field: TrackedField): string {
  switch (field) {
    case 'order':
      return String(page.order);
    default:
      return String((page as unknown as Record<string, unknown>)[field] ?? '');
  }
}

/**
 * Capture the tracked fields as plain strings.
 *
 * MUST be called before any mutation. Returning strings rather than references is
 * what makes the snapshot immune to the entity being mutated in place afterwards
 * (`applyEdit`/`moveTo` both mutate `DocPageEntity` in place).
 */
export function snapshotDocPage(page: DocPageEntity): DocPageSnapshot {
  const snap = {} as DocPageSnapshot;
  for (const field of TRACKED_FIELDS) snap[field] = read(page, field);
  return snap;
}

/** Fields that differ between the snapshot and the entity's current state. */
export function diffDocPage(before: DocPageSnapshot, after: DocPageEntity): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of TRACKED_FIELDS) {
    const now = read(after, field);
    if (now === before[field]) continue;
    const noValue = NO_VALUE_FIELDS.includes(field);
    changes.push({
      field,
      oldValue: noValue ? '' : before[field],
      newValue: noValue ? '' : now,
    });
  }
  return changes;
}
