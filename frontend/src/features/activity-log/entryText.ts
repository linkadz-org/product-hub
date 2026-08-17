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

/**
 * The three orderable pieces of a history sentence, besides the subject.
 *
 *  - `field` — what changed ("status" / "상태를")
 *  - `values` — the old → new chips, rendered as markup by the component
 *  - `verb` — what happened to it ("changed" / "변경함")
 *
 * English is SVO and reads verb · field · values ("changed status
 * [Backlog] → [Done]"); Korean is SOV and reads field · values · verb
 * ("상태를 [Backlog] → [Done] 변경함"). Which is which is NOT a boolean in the
 * code — it is read off each locale's own `activityLog.sentence` template, so a
 * third language orders itself by editing its dictionary.
 */
export type SentenceSlot = 'field' | 'values' | 'verb';

/** Pieces a component assembles into a sentence — never raw markup.
 *
 *  `order` is the whole word-order decision: the slots this row actually has,
 *  already sorted into the current locale's order and already filtered to the
 *  non-empty ones. A component renders `subject` and then walks `order` — it
 *  never decides where the field or the values go, which is exactly the mistake
 *  that shipped Korean as "Felix [Backlog] → [Done] 상태 변경함". */
export interface EntryText {
  subject: string;
  /** The field label in sentence form, including any locale particle
   *  ("status" / "상태를"). Empty for whole-sentence events (created, deleted,
   *  version_restored), whose verb already names its own object. */
  field: string;
  verb: string;
  from: string;
  to: string;
  /** True when the field's value is deliberately not recorded (long-form text
   *  like a description, or a bare id with no display form) — the sentence
   *  reads "edited the X" / "changed cycle", never "from … to …". */
  noValue: boolean;
  order: SentenceSlot[];
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
  | 'order'
  // Roadmap-item fields (see backend/src/application/roadmaps/domain/roadmap-item-diff.ts).
  // `status` / `title` / `description` / `assignees` / `startDate` / `endDate`
  // are shared with issues above; these are the item's own. `phase` is the board
  // pool the card sits in, a different field from `status` — both are tracked.
  | 'phase'
  | 'difficulty'
  | 'progress'
  | 'reach'
  | 'impact'
  | 'confidence'
  | 'effort'
  | 'okrLabel'
  // Test-case field (see backend/.../set-test-case-result.use-case.ts). Reaches an
  // issue's timeline as a *related* row, never on an issue of its own.
  | 'result';

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
  phase: 'activityLog.field.phase',
  difficulty: 'activityLog.field.difficulty',
  progress: 'activityLog.field.progress',
  reach: 'activityLog.field.reach',
  impact: 'activityLog.field.impact',
  confidence: 'activityLog.field.confidence',
  effort: 'activityLog.field.effort',
  okrLabel: 'activityLog.field.okrLabel',
  result: 'activityLog.field.result',
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

/** The placeholder each slot occupies in an `activityLog.sentence` template. */
const SLOT_TOKEN: Record<SentenceSlot, string> = {
  field: '{field}',
  values: '{values}',
  verb: '{verb}',
};

/** A locale whose grammar needs a particle glued to the field label declares it
 *  here, immediately after `{field}` (see `ko.ts`). English has no such token
 *  and never pays for one. */
const OBJECT_PARTICLE_TOKEN = '{objectParticle}';

/**
 * The Korean object particle for `word` — 을 after a syllable that ends in a
 * consonant, 를 after one that ends in a vowel. Computed rather than baked into
 * each label because the same label is reused across sentences, and because
 * getting it wrong is the difference between "상태를 변경함" and a sentence a
 * Korean reader trips over.
 *
 * Returns '' for anything that is not a Hangul syllable (a Latin acronym, a
 * digit, an empty label) — no particle is better than the wrong one. Only ever
 * reached when the active locale's template asks for it.
 */
function objectParticle(word: string): string {
  const code = word.codePointAt(word.length - 1) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return '';
  // Hangul syllables are laid out (initial × 21 vowels × 28 finals); final 0 is
  // "no final consonant".
  return (code - 0xac00) % 28 === 0 ? '를' : '을';
}

/** The field label as it appears in the sentence — its translation plus any
 *  particle the locale's own template asked for. */
function fieldText(field: string): string {
  const label = fieldLabel(field);
  if (!t('activityLog.sentence').includes(OBJECT_PARTICLE_TOKEN)) return label;
  return label + objectParticle(label);
}

/** An empty `oldValue` reads as "not set", never as a blank gap before the
 *  arrow (e.g. "changed assignee → Felix" with nothing on the left). */
function displayValue(value: string): string {
  return value === '' ? t('activityLog.notSet') : value;
}

/**
 * The slots this row has, in the order the current locale's own
 * `activityLog.sentence` template lists them.
 *
 * Reading the order off the template (rather than a boolean, or a component's
 * hardcoded layout) is the whole point: `en` says `{verb} {field} {values}` and
 * `ko` says `{field}{objectParticle} {values} {verb}`, and neither language's
 * word order is written anywhere else. A slot the template forgot to mention
 * sorts last rather than disappearing — a broken sentence beats a missing verb.
 */
function slotOrder(present: Record<SentenceSlot, boolean>): SentenceSlot[] {
  const template = t('activityLog.sentence');
  return (Object.keys(SLOT_TOKEN) as SentenceSlot[])
    .filter((slot) => present[slot])
    .map((slot) => {
      const at = template.indexOf(SLOT_TOKEN[slot]);
      return { slot, at: at < 0 ? Number.MAX_SAFE_INTEGER : at };
    })
    .sort((a, b) => a.at - b.at)
    .map((x) => x.slot);
}

/** Turn one activity row into the pieces a component assembles into a
 *  sentence. Pure — no React, never throws on an unrecognised field. The
 *  component renders `subject`, then walks `order`; it must not decide where
 *  the field or the values go, the same mistake `slotOrder()` exists to avoid
 *  one level down. */
export function describeEntry(entry: ActivityEntry): EntryText {
  // Bare actor name — the "(API key)" / "(automated)" signal is carried by
  // badges next to it (see ActivityEntry.tsx), not duplicated into the text.
  const subject = entry.actorType === 'system' ? t('activityLog.systemActor') : entry.actorName;

  const build = (
    field: string,
    verb: string,
    from: string,
    to: string,
    noValue: boolean,
  ): EntryText => ({
    subject,
    field,
    verb,
    from,
    to,
    noValue,
    order: slotOrder({
      field: field !== '',
      values: !noValue && (from !== '' || to !== ''),
      verb: true,
    }),
  });

  // Whole-sentence events: the verb already names its own object ("created
  // this" / "이 항목을 생성함"), so there is no separate field slot to order.
  if (entry.field === 'created') return build('', t('activityLog.verb.created'), '', '', false);
  if (entry.field === 'deleted') return build('', t('activityLog.verb.deleted'), '', '', false);
  // Doc pages only (RestoreDocPageVersionUseCase). A dedicated event, not a
  // diff of `title`/`content` — "restored an earlier version" is the useful
  // fact, not the version's label, so this reads like `created`/`deleted`
  // above rather than a value-bearing field change.
  if (entry.field === 'version_restored') {
    return build('', t('activityLog.verb.restored'), '', '', false);
  }

  // Long-form text ("edited the description") and a bare id with no display
  // form ("changed cycle") are both value-less, but they are not the same
  // sentence — only "don't show values" is shared (NO_VALUE_FIELDS); the verb
  // still depends on which sub-case this field is.
  if (LONG_TEXT_FIELDS.has(entry.field)) {
    return build(fieldText(entry.field), t('activityLog.verb.edited'), '', '', true);
  }
  if (NO_VALUE_FIELDS.has(entry.field)) {
    return build(fieldText(entry.field), t('activityLog.verb.changed'), '', '', true);
  }

  return build(
    fieldText(entry.field),
    t('activityLog.verb.changed'),
    displayValue(entry.oldValue),
    displayValue(entry.newValue),
    false,
  );
}
