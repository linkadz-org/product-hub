import { t, type I18nKey } from '@/i18n';

/**
 * The shape a history row arrives in from `GET /v1/activity`
 * (`ActivityEntryDto`, backend/src/application/audit-log/dtos). Declared
 * locally rather than imported so this module stays a pure, dependency-free
 * text formatter — the only piece of the activity log testable without
 * rendering (this repo has no `@testing-library/react`).
 */
export interface ActivityEntry {
  id: string;
  entity: string;
  entityId: string;
  entityRef: string;
  field: string;
  oldValue: string;
  newValue: string;
  actorType: 'user' | 'api' | 'system';
  actorId: string;
  actorName: string;
  automated: boolean;
  createdAt: string;
  relationLabel: string;
}

/** Pieces a component assembles into a sentence — never raw markup. */
export interface EntryText {
  subject: string;
  verb: string;
  from: string;
  to: string;
  longText: boolean;
}

/** Tracked fields the backend may record a change against. */
export type TrackedField =
  | 'status'
  | 'assignees'
  | 'severity'
  | 'type'
  | 'labelKeys'
  | 'estimate'
  | 'cycleId'
  | 'parentId'
  | 'startDate'
  | 'endDate'
  | 'dueDate'
  | 'projectId'
  | 'roadmapItemId'
  | 'reportId'
  | 'caseId'
  | 'title'
  | 'description';

/**
 * Field name -> i18n key for its label. A `Record` over the closed
 * `TrackedField` union so an omission is a compile error rather than a
 * runtime blank — never build this key by string concatenation.
 */
export const FIELD_LABEL: Record<TrackedField, I18nKey> = {
  status: 'activityLog.field.status',
  assignees: 'activityLog.field.assignees',
  severity: 'activityLog.field.severity',
  type: 'activityLog.field.type',
  labelKeys: 'activityLog.field.labelKeys',
  estimate: 'activityLog.field.estimate',
  cycleId: 'activityLog.field.cycleId',
  parentId: 'activityLog.field.parentId',
  startDate: 'activityLog.field.startDate',
  endDate: 'activityLog.field.endDate',
  dueDate: 'activityLog.field.dueDate',
  projectId: 'activityLog.field.projectId',
  roadmapItemId: 'activityLog.field.roadmapItemId',
  reportId: 'activityLog.field.reportId',
  caseId: 'activityLog.field.caseId',
  title: 'activityLog.field.title',
  description: 'activityLog.field.description',
};

/** Fields whose values are deliberately stored empty by the backend (they're
 *  long-form text) — the sentence reads "edited the X", never "from … to …". */
const LONG_TEXT_FIELDS = new Set<string>(['title', 'description']);

function isTrackedField(field: string): field is TrackedField {
  return Object.prototype.hasOwnProperty.call(FIELD_LABEL, field);
}

/** Field name as it reads in a sentence: its i18n label, or — for a field the
 *  frontend doesn't know yet — the raw name. A future backend field must
 *  render honestly, not crash the timeline. */
function fieldLabel(field: string): string {
  return isTrackedField(field) ? t(FIELD_LABEL[field]) : field;
}

/** An empty `oldValue` reads as "not set", never as a blank gap before the
 *  arrow (e.g. "changed assignee → Felix" with nothing on the left). */
function displayValue(value: string): string {
  return value === '' ? t('activityLog.notSet') : value;
}

/** Turn one activity row into the pieces a component assembles into a
 *  sentence. Pure — no React, never throws on an unrecognised field. */
export function describeEntry(entry: ActivityEntry): EntryText {
  const subject =
    entry.actorType === 'system'
      ? t('activityLog.systemActor')
      : entry.actorType === 'api'
        ? `${entry.actorName} (${t('activityLog.viaApiKey')})`
        : entry.actorName;

  if (entry.field === 'created') {
    return { subject, verb: t('activityLog.verb.created'), from: '', to: '', longText: false };
  }
  if (entry.field === 'deleted') {
    return { subject, verb: t('activityLog.verb.deleted'), from: '', to: '', longText: false };
  }

  const longText = LONG_TEXT_FIELDS.has(entry.field);
  if (longText) {
    return {
      subject,
      verb: `${t('activityLog.verb.edited')} ${fieldLabel(entry.field)}`,
      from: '',
      to: '',
      longText: true,
    };
  }

  return {
    subject,
    verb: `${t('activityLog.verb.changed')} ${fieldLabel(entry.field)}`,
    from: displayValue(entry.oldValue),
    to: displayValue(entry.newValue),
    longText: false,
  };
}
