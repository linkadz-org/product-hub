// A register of the call sites that must be wired to the activity log.
//
// Coarse on purpose — it reads source text rather than behaviour, because this
// repo has no @testing-library/react and neither a React hook nor a query-cache
// invalidation can be driven from a plain unit test. It exists because the two
// defects it pins were *invisible* to every behavioural test that could be
// written here:
//
//  - three entity kinds are recorded and served by the backend, but only issues
//    were ever asked for, so doc-page and roadmap-item history was write-only;
//  - a doc or roadmap write never invalidated ['activity'], so an open issue's
//    timeline kept showing the old title.
//
// Add a surface, or a mutation module, to the lists below — or say here why not.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Paths are relative to `frontend/`, which is vitest's cwd here. */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('activity log wiring', () => {
  // C2: all three kinds the backend guards (get-activity.use-case.ts) have a
  // surface that asks for them. Fails if a surface stops requesting history, or
  // requests it for the wrong kind.
  const SURFACES: [string, string[]][] = [
    // Issues (bug/task) and roadmap items share one timeline component.
    ['src/features/activity/CommentThread.tsx', ['useActivity', "'issue'", "'roadmap_item'"]],
    // A doc page's own history, in the comments rail's History tab.
    ['src/features/docs/components/DocComments.tsx', ["useActivity('doc_page'", 'ActivityEntry']],
  ];
  for (const [path, needles] of SURFACES) {
    it(`${path} requests activity`, () => {
      const src = read(path);
      for (const needle of needles) expect(src, `${path} is missing ${needle}`).toContain(needle);
    });
  }

  // C5: a write that can change what a timeline shows must invalidate it. The
  // query key is ['activity', entity, entityId], so a prefix invalidation on
  // ['activity'] reaches every entity's cached history. The modules spell that
  // prefix differently (a literal `queryKey: ['activity']`, or `'activity'` in a
  // shared list of cache keys), so the assertion is on the key name itself.
  const MUTATORS = [
    // Issue writes — the three that were already correct.
    'src/features/issues/hook-factory.ts',
    'src/features/issues/bulk.api.ts',
    'src/features/tasks/api.ts',
    // Doc-page and roadmap-item writes — the two that were not. Both feed an
    // issue's *related* rows as well as their own newly-rendered timelines.
    'src/features/docs/api.ts',
    'src/features/roadmaps/api.ts',
  ];
  for (const path of MUTATORS) {
    it(`${path} invalidates the activity cache`, () => {
      expect(read(path), `${path} never invalidates ['activity']`).toContain("'activity'");
    });
  }
});
