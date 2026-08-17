import { describe, expect, it } from 'vitest';
import { t, type I18nKey } from '@/i18n';
import { describeEntry, FIELD_LABEL } from './entryText';

const base = {
  id: 'a1',
  entity: 'issue',
  entityId: 'i1',
  entityRef: 'QC-10',
  actorType: 'user',
  actorId: 'u1',
  actorName: 'Felix',
  automated: false,
  createdAt: new Date().toISOString(),
  relationLabel: '',
};

describe('describeEntry', () => {
  it('renders a short field change with both values', () => {
    const r = describeEntry({ ...base, field: 'status', oldValue: 'Backlog', newValue: 'Done' } as never);
    expect(r.subject).toBe('Felix');
    expect(r.from).toBe('Backlog');
    expect(r.to).toBe('Done');
    expect(r.noValue).toBe(false);
  });

  it('renders long text as edited, with no values', () => {
    const r = describeEntry({ ...base, field: 'description', oldValue: '', newValue: '' } as never);
    expect(r.noValue).toBe(true);
    expect(r.from).toBe('');
    expect(r.to).toBe('');
    expect(r.verb).toContain('edited');
  });

  it('renders creation', () => {
    const r = describeEntry({ ...base, field: 'created', oldValue: '', newValue: '' } as never);
    expect(r.verb).toContain('created');
  });

  it('marks an empty old value as unset rather than blank', () => {
    const r = describeEntry({ ...base, field: 'assignees', oldValue: '', newValue: 'Felix' } as never);
    expect(r.from).not.toBe('');
  });

  it('never throws on a field it does not know', () => {
    const r = describeEntry({ ...base, field: 'somethingNew', oldValue: 'a', newValue: 'b' } as never);
    expect(r.subject).toBe('Felix');
  });

  // FIX 1: the subject must never carry "(API key)" — that's the badge's job
  // (ActivityEntry.tsx). Their absence here is exactly why every API-key row
  // shipped reading "qa-runner (API key) [API key]".
  it('renders a bare actor name for an API-key actor — no parenthetical', () => {
    const r = describeEntry({
      ...base,
      actorType: 'api',
      actorName: 'qa-runner',
      field: 'status',
      oldValue: 'Backlog',
      newValue: 'Done',
    } as never);
    expect(r.subject).toBe('qa-runner');
    expect(r.subject).not.toContain('API key');
  });

  it('renders the system actor label for a system actor', () => {
    const r = describeEntry({
      ...base,
      actorType: 'system',
      actorName: '',
      field: 'status',
      oldValue: 'Backlog',
      newValue: 'Done',
    } as never);
    expect(r.subject).not.toBe('');
    expect(r.subject).not.toContain('API key');
  });

  // FIX 4: raw ids with no display form read as "changed X", no arrow of ids.
  it('renders cycleId/parentId/projectId as value-less, using the "changed" verb', () => {
    for (const field of ['cycleId', 'parentId', 'projectId']) {
      const r = describeEntry({ ...base, field, oldValue: '', newValue: '' } as never);
      expect(r.noValue).toBe(true);
      expect(r.from).toBe('');
      expect(r.to).toBe('');
      expect(r.verb).toContain('changed');
    }
  });

  // Backend fix: title was promoted out of the long-text set (issue-diff.ts /
  // doc-page-diff.ts) because "renamed" with no values tells you nothing, and
  // a title is short enough that the storage argument for `description`
  // never applied to it. It must render like an ordinary value-bearing field.
  it('renders a title change with its real values, not as "edited the title"', () => {
    const r = describeEntry({
      ...base,
      field: 'title',
      oldValue: 'Login fails',
      newValue: 'Login fails on Safari',
    } as never);
    expect(r.noValue).toBe(false);
    expect(r.from).toBe('Login fails');
    expect(r.to).toBe('Login fails on Safari');
    expect(r.verb).toContain('changed');
  });

  // A doc-page reorder among siblings: the move is worth a row, the raw
  // position index is not — nobody reads "changed position from 3 to 5" as
  // history.
  it('renders order as value-less — no raw position index', () => {
    const r = describeEntry({ ...base, field: 'order', oldValue: '', newValue: '' } as never);
    expect(r.noValue).toBe(true);
    expect(r.from).toBe('');
    expect(r.to).toBe('');
    expect(r.verb).toContain('changed');
  });

  // Unmapped since Task 15 first shipped — previously rendered the raw field
  // name "version_restored" via the generic fallback branch.
  it('renders version_restored with a dedicated verb, not the raw field name', () => {
    const r = describeEntry({
      ...base,
      entity: 'doc_page',
      field: 'version_restored',
      oldValue: '',
      newValue: 'Before the rewrite',
    } as never);
    expect(r.verb).toContain('restored');
    expect(r.verb).not.toContain('version_restored');
    expect(r.noValue).toBe(false);
    expect(r.from).toBe('');
    expect(r.to).toBe('');
  });

  it('renders roadmapItemId/caseId as an ordinary value pair (already a label, not an id)', () => {
    const r = describeEntry({
      ...base,
      field: 'roadmapItemId',
      oldValue: '',
      newValue: 'Search v2',
    } as never);
    expect(r.noValue).toBe(false);
    expect(r.to).toBe('Search v2');
  });

  // Replaces a test that asserted `typeof r.valuesBeforeVerb === 'boolean'` —
  // which passed against `true`, against `false`, and against the shipped bug.
  // The assembled-sentence tests live in ActivityEntry.spec.ts; these pin the
  // slot list `describeEntry` hands the component.
  it('orders the slots verb · field · values under the default (en) locale', () => {
    const r = describeEntry({ ...base, field: 'status', oldValue: 'Backlog', newValue: 'Done' } as never);
    expect(r.order).toEqual(['verb', 'field', 'values']);
    expect(r.field).toBe('status');
    expect(r.verb).toBe('changed');
  });

  it('omits the values slot on a value-less row, and the field slot on a whole-sentence event', () => {
    const noValue = describeEntry({ ...base, field: 'cycleId', oldValue: '', newValue: '' } as never);
    expect(noValue.order).toEqual(['verb', 'field']);

    const created = describeEntry({ ...base, field: 'created', oldValue: '', newValue: '' } as never);
    expect(created.order).toEqual(['verb']);
    expect(created.field).toBe('');
  });

  // Every field the backend diffs must have a label — a missing one renders the
  // raw wire name ("phase 변경함"), an English token inside a Korean sentence.
  // Sources: issue-diff.ts, doc-page-diff.ts, roadmap-item-diff.ts and
  // set-test-case-result.use-case.ts.
  it('labels every field the backend can emit — no raw wire names', () => {
    const emitted = [
      // issue-diff.ts
      'status', 'assignees', 'severity', 'type', 'labelKeys', 'estimate', 'cycleId',
      'parentId', 'startDate', 'endDate', 'projectId', 'roadmapItemId', 'reportId',
      'caseId', 'title', 'description',
      // doc-page-diff.ts
      'order',
      // roadmap-item-diff.ts
      'phase', 'difficulty', 'progress', 'reach', 'impact', 'confidence', 'effort', 'okrLabel',
      // set-test-case-result.use-case.ts
      'result',
    ];
    for (const field of emitted) {
      const key = (FIELD_LABEL as Record<string, I18nKey>)[field];
      expect(key, `${field} has no FIELD_LABEL entry`).toBeDefined();
      // `t()` returns the key itself on a miss, so this catches a mapped field
      // whose key was never added to the dictionaries.
      expect(t(key), `${key} is missing from en.ts`).not.toBe(key);
    }
  });
});
