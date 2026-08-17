import { IssueEntity } from './entities/issue.entity';

/**
 * Fields whose changes become history rows.
 *
 * Deliberately a fixed, explicit list rather than a walk over every property:
 * adding a field to the entity must not silently start logging it.
 *
 * Note there is NO `priority` field on an issue — a bug's urgency is `severity`.
 * `customFields` is excluded in v1 because rendering its labels would require
 * resolving per-team configuration.
 */
export const TRACKED_FIELDS = [
  'title',
  'description',
  'status',
  'cycleId',
  'parentId',
  'assignees',
  'severity',
  'type',
  'labelKeys',
  'estimate',
  'startDate',
  'endDate',
  // NOT 'dueDate': IssueEntity.applyUpdate keeps endDate/dueDate mirrored for a
  // task (setting either writes both, see issue.entity.ts ~357-364), so tracking
  // both would emit two rows with identical timestamps for one deadline edit.
  'projectId',
  'roadmapItemId',
  'reportId',
  'caseId',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/**
 * Fields recorded as "changed" with no values shown.
 *
 * Two different reasons land a field here, generalised into one set:
 *  - long-form text (`description`): a 4KB description edited ten times would
 *    otherwise produce 80KB of log for one issue, for something almost nobody
 *    reads back. Anyone who genuinely needs old content needs a versioning
 *    system, not a log line. `title` does NOT belong here — a title tops out
 *    around 160 characters, so the storage argument that justifies hiding a
 *    4KB description doesn't apply, and "renamed" with no values is a log
 *    line that tells you nothing. Doc-page titles were never value-less (see
 *    `doc-page-diff.ts`); this promotes the issue path to match rather than
 *    demoting the doc-page one, per spec §5.2's own note that promoting
 *    `title` later is additive.
 *  - a bare id with no display form (`cycleId`, `parentId`, `projectId`): the
 *    event is worth recording, but a raw UUID is not worth showing, and
 *    resolving it to a name would require a repository lookup in this module,
 *    which is deliberately pure (no I/O). Unlike `roadmapItemId`/`caseId`
 *    below, these have no label already carried on the entity, so they stay
 *    value-less rather than costing a read on the write path. Enriching them
 *    later (e.g. once a related-object assembly step exists) is additive.
 */
export const NO_VALUE_FIELDS: readonly string[] = [
  'description',
  'cycleId',
  'parentId',
  'projectId',
];

export interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
}

export type IssueSnapshot = Record<TrackedField, string>;

/** Render one tracked field as the flat string the log stores. */
function read(issue: IssueEntity, field: TrackedField): string {
  switch (field) {
    case 'assignees':
      return (issue.assignees ?? []).map((a) => a.name).join(', ');
    case 'labelKeys':
      return (issue.labelKeys ?? []).join(', ');
    case 'estimate':
      // `estimate` is typed `number` on the entity and defaults to 0 — never
      // undefined/null, so there is nothing to guard here.
      return String(issue.estimate);
    // Both already carry a human label on the entity at zero extra cost —
    // render that instead of the raw id, same as `assignees`/`labelKeys`
    // above. See NO_VALUE_FIELDS for the ids that have no such label.
    case 'roadmapItemId':
      return issue.roadmapItemLabel ?? '';
    case 'caseId':
      return issue.caseLabel ?? '';
    default:
      return String((issue as unknown as Record<string, unknown>)[field] ?? '');
  }
}

/**
 * Capture the tracked fields as plain strings.
 *
 * MUST be called before any mutation. Returning strings rather than references is
 * what makes the snapshot immune to the entity being mutated in place afterwards.
 */
export function snapshotIssue(issue: IssueEntity): IssueSnapshot {
  const snap = {} as IssueSnapshot;
  for (const field of TRACKED_FIELDS) snap[field] = read(issue, field);
  return snap;
}

/** Fields that differ between the snapshot and the entity's current state. */
export function diffIssue(before: IssueSnapshot, after: IssueEntity): FieldChange[] {
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
