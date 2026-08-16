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

/** Pieces a component assembles into a sentence — never raw markup.
 *
 *  `valuesBeforeVerb` carries the locale's word order (English SVO puts the
 *  verb first; Korean SOV puts the values first) so the *component* renders
 *  in whatever order `describeEntry` — driven by the same `activityLog.sentence`
 *  template `sentence()` already reads — says to, rather than a component
 *  hardcoding the English layout one level above where `sentence()` already
 *  solved this. */
export interface EntryText {
  subject: string;
  verb: string;
  from: string;
  to: string;
  /** True when the field's value is deliberately not recorded (long-form text
   *  like a description, or a bare id with no display form) — the sentence
   *  reads "edited the X" / "changed cycle", never "from … to …". */
  noValue: boolean;
  valuesBeforeVerb: boolean;
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
  | 'description'
  // Doc-page-only field (see backend/src/application/docs/domain/doc-page-diff.ts):
  // a page's rank among its siblings. Value-less — see NO_VALUE_FIELDS below.
  | 'order';

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
  order: 'activityLog.field.order',
};

/** Long-form-text fields: the backend never stores their content, so the
 *  sentence reads "edited the X" — a distinct verb from a plain value change.
 *
 *  `title` is deliberately NOT here (nor is it in NO_VALUE_FIELDS below): the
 *  backend promoted it to a value-bearing field — see `issue-diff.ts` and
 *  `doc-page-diff.ts` — because "renamed" with no values is a log line that
 *  tells you nothing, and a title is short enough that the storage argument
 *  for `description` never applied to it. It falls through to the generic
 *  value-pair branch at the bottom of `describeEntry`, same as `status`. */
const LONG_TEXT_FIELDS = new Set<string>(['description']);

/** Fields whose values are deliberately stored empty by the backend — the
 *  superset of {@link LONG_TEXT_FIELDS} plus bare ids/indexes with no display
 *  form (`cycleId`, `parentId`, `projectId`; see NO_VALUE_FIELDS in
 *  backend/src/application/issues/domain/issue-diff.ts for why). `order` is
 *  the doc-page equivalent (see NO_VALUE_FIELDS in
 *  backend/src/application/docs/domain/doc-page-diff.ts): the move is worth a
 *  row, the raw position index is not. Mirrors those backend sets so the row
 *  never shows a raw uuid or an integer nobody reads as history; verb choice
 *  for the long-text vs. bare-id/index sub-cases still differs (see
 *  `describeEntry`), only "don't show values" is shared here — that is the
 *  concept this generalises. */
const NO_VALUE_FIELDS = new Set<string>([
  ...LONG_TEXT_FIELDS,
  'cycleId',
  'parentId',
  'projectId',
  'order',
]);

function isTrackedField(field: string): field is TrackedField {
  return Object.prototype.hasOwnProperty.call(FIELD_LABEL, field);
}

/** Field name as it reads in a sentence: its i18n label, or — for a field the
 *  frontend doesn't know yet — the raw name. A future backend field must
 *  render honestly, not crash the timeline. */
function fieldLabel(field: string): string {
  return isTrackedField(field) ? t(FIELD_LABEL[field]) : field;
}

/**
 * `verb` + `field` in the current locale's word order — English is SVO
 * ("changed status"), Korean is SOV ("상태 변경함"). A naive `${verb} ${field}`
 * join is only ever correct for English, so the join lives here, driven by
 * the `activityLog.sentence` template, rather than in a component that would
 * bake the English order into every locale.
 */
function sentence(verb: string, field: string): string {
  return t('activityLog.sentence').replace('{verb}', verb).replace('{field}', field);
}

/** An empty `oldValue` reads as "not set", never as a blank gap before the
 *  arrow (e.g. "changed assignee → Felix" with nothing on the left). */
function displayValue(value: string): string {
  return value === '' ? t('activityLog.notSet') : value;
}

/** Whether the locale's `activityLog.sentence` template puts the field before
 *  the verb (Korean SOV) rather than after (English SVO) — read from the raw
 *  template itself so this stays in lockstep with `sentence()` above instead
 *  of hardcoding a second copy of the word-order decision. */
function valuesBeforeVerb(): boolean {
  const template = t('activityLog.sentence');
  return template.indexOf('{field}') < template.indexOf('{verb}');
}

/** Turn one activity row into the pieces a component assembles into a
 *  sentence. Pure — no React, never throws on an unrecognised field. The
 *  component renders `subject`/`verb`/values in the order `valuesBeforeVerb`
 *  says — it must not hardcode English's verb-then-values layout itself,
 *  the same mistake `sentence()` exists to avoid one level down. */
export function describeEntry(entry: ActivityEntry): EntryText {
  // Bare actor name — the "(API key)" / "(automated)" signal is carried by
  // badges next to it (see ActivityEntry.tsx), not duplicated into the text.
  const subject = entry.actorType === 'system' ? t('activityLog.systemActor') : entry.actorName;
  const order = valuesBeforeVerb();

  if (entry.field === 'created') {
    return {
      subject,
      verb: t('activityLog.verb.created'),
      from: '',
      to: '',
      noValue: false,
      valuesBeforeVerb: order,
    };
  }
  if (entry.field === 'deleted') {
    return {
      subject,
      verb: t('activityLog.verb.deleted'),
      from: '',
      to: '',
      noValue: false,
      valuesBeforeVerb: order,
    };
  }
  // Doc pages only (RestoreDocPageVersionUseCase). A dedicated event, not a
  // diff of `title`/`content` — "restored an earlier version" is the useful
  // fact, not the version's label, so this reads like `created`/`deleted`
  // above rather than a value-bearing field change.
  if (entry.field === 'version_restored') {
    return {
      subject,
      verb: t('activityLog.verb.restored'),
      from: '',
      to: '',
      noValue: false,
      valuesBeforeVerb: order,
    };
  }

  // Long-form text ("edited the description") and a bare id with no display
  // form ("changed cycle") are both value-less, but they are not the same
  // sentence — only "don't show values" is shared (NO_VALUE_FIELDS); the verb
  // still depends on which sub-case this field is.
  if (LONG_TEXT_FIELDS.has(entry.field)) {
    return {
      subject,
      verb: sentence(t('activityLog.verb.edited'), fieldLabel(entry.field)),
      from: '',
      to: '',
      noValue: true,
      valuesBeforeVerb: order,
    };
  }
  if (NO_VALUE_FIELDS.has(entry.field)) {
    return {
      subject,
      verb: sentence(t('activityLog.verb.changed'), fieldLabel(entry.field)),
      from: '',
      to: '',
      noValue: true,
      valuesBeforeVerb: order,
    };
  }

  return {
    subject,
    verb: sentence(t('activityLog.verb.changed'), fieldLabel(entry.field)),
    from: displayValue(entry.oldValue),
    to: displayValue(entry.newValue),
    noValue: false,
    valuesBeforeVerb: order,
  };
}
