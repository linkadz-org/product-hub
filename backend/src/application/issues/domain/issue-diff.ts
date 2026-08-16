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
  'dueDate',
  'projectId',
  'roadmapItemId',
  'reportId',
  'caseId',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];

/**
 * Fields recorded as "changed" with no values.
 *
 * A 4KB description edited ten times would otherwise produce 80KB of log for one
 * issue, for something almost nobody reads back. Anyone who genuinely needs old
 * content needs a versioning system, not a log line.
 */
export const LONG_TEXT_FIELDS: readonly string[] = ['title', 'description'];

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
      return issue.estimate === undefined || issue.estimate === null
        ? ''
        : String(issue.estimate);
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
    const isLongText = LONG_TEXT_FIELDS.includes(field);
    changes.push({
      field,
      oldValue: isLongText ? '' : before[field],
      newValue: isLongText ? '' : now,
    });
  }
  return changes;
}
