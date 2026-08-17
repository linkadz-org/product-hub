// The assembled sentence, rendered by the real component, in BOTH languages.
//
// This is the test the branch was missing. `entryText.spec.ts` only ever
// asserted `typeof valuesBeforeVerb === 'boolean'` — true against the correct
// order, true against the reversed one, and true against the bug that shipped:
// Korean rendered "Felix [Backlog] → [Done] 상태 변경함", stranding the field
// behind the values, because the component placed an already-joined
// "{field} {verb}" blob after the chips.
//
// So it renders `ActivityEntry` for real (react-dom/server — this repo has no
// @testing-library/react) and asserts the visible word order. Written with
// `createElement` rather than JSX so it stays a `.spec.ts` and is picked up by
// the existing `src/**/*.spec.ts` include.
//
// Locale is resolved ONCE at i18n module load (`i18n/index.ts`: `const locale`),
// so each language needs its own module graph — hence `vi.resetModules()` plus a
// dynamic import after setting the stored choice.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entry = {
  id: 'a1',
  entity: 'issue',
  entityId: 'i1',
  entityRef: 'QC-10',
  field: 'status',
  oldValue: 'Backlog',
  newValue: 'Done',
  actorType: 'user',
  actorId: 'u1',
  actorName: 'Felix',
  automated: false,
  createdAt: new Date().toISOString(),
  relationLabel: '',
};

/** The row as a reader sees it: markup out, one space per element boundary in,
 *  so adjacent spans don't run their words together. */
async function renderRow(locale: 'en' | 'ko', overrides: Record<string, unknown> = {}) {
  localStorage.setItem('ph_locale', locale);
  vi.resetModules();
  const { ActivityEntry } = await import('./ActivityEntry');
  const html = renderToStaticMarkup(
    createElement(ActivityEntry, { entry: { ...entry, ...overrides } as never }),
  );
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('ActivityEntry — assembled sentence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('reads subject · verb · field · values in English (SVO)', async () => {
    const text = await renderRow('en');
    expect(text).toContain('Felix changed status Backlog → Done');
  });

  // Fails against the pre-fix code, which rendered
  // "Felix Backlog → Done 상태 변경함".
  it('reads subject · field · values · verb in Korean (SOV)', async () => {
    const text = await renderRow('ko');
    expect(text).toContain('Felix 상태를 Backlog → Done 변경함');
    // The field must not trail the values — the exact shape of the shipped bug.
    expect(text).not.toContain('Done 상태');
  });

  // Value-less rows read correctly in both languages today; they must keep to.
  it('keeps value-less rows correct in both languages', async () => {
    expect(await renderRow('en', { field: 'description', oldValue: '', newValue: '' })).toContain(
      'Felix edited the description',
    );
    expect(await renderRow('ko', { field: 'description', oldValue: '', newValue: '' })).toContain(
      'Felix 설명을 수정함',
    );
    expect(await renderRow('ko', { field: 'cycleId', oldValue: '', newValue: '' })).toContain(
      'Felix 사이클을 변경함',
    );
  });

  // A whole-sentence event has no separate field slot in either language.
  it('renders a creation event as verb only', async () => {
    expect(await renderRow('en', { field: 'created', oldValue: '', newValue: '' })).toContain(
      'Felix created this',
    );
    expect(await renderRow('ko', { field: 'created', oldValue: '', newValue: '' })).toContain(
      'Felix 이 항목을 생성함',
    );
  });

  // 을 after a final consonant, 를 after a vowel — computed from the label, so
  // the same helper has to get both branches right.
  it('picks the Korean object particle from the label ending', async () => {
    // 상태 ends in a vowel → 를; 라벨 ends in ㄹ → 을.
    expect(await renderRow('ko', { field: 'status' })).toContain('상태를');
    expect(await renderRow('ko', { field: 'labelKeys' })).toContain('라벨을');
    // A roadmap-item field the frontend had no label for at all before this fix.
    expect(await renderRow('ko', { field: 'phase' })).toContain('단계를');
    expect(await renderRow('ko', { field: 'phase' })).not.toContain('phase');
  });

  // A system row already says "Automatically" in the subject; the "automatic"
  // badge beside it was the same fact twice.
  it('does not show the automatic badge next to the system subject', async () => {
    const text = await renderRow('en', { actorType: 'system', actorName: '', automated: true });
    expect(text).toContain('Automatically');
    expect(text).not.toContain('automatic');
    // …but it still shows for an automated write done under a real name.
    const human = await renderRow('en', { automated: true });
    expect(human).toContain('automatic');
  });
});
