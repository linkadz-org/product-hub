import 'reflect-metadata';
import {
  CreateIssueUseCase,
  DeleteIssueUseCase,
  SetIssueStatusUseCase,
  UpdateIssueUseCase,
} from '@application/issues/use-cases';
import {
  CreateDocUseCase,
  DeleteDocUseCase,
  DuplicateDocUseCase,
} from '@application/docs/use-cases/doc.use-cases';
import {
  CreateDocPageUseCase,
  DeleteDocPageUseCase,
  ReorderDocPagesUseCase,
  UpdateDocPageUseCase,
} from '@application/docs/use-cases/doc-page.use-cases';
import { RestoreDocPageVersionUseCase } from '@application/docs/use-cases/doc-page-version.use-cases';
import {
  AddRoadmapItemUseCase,
  DeleteRoadmapUseCase,
  ReplaceRoadmapItemsUseCase,
} from '@application/roadmaps/use-cases/roadmap.use-cases';
import {
  DeleteCycleUseCase,
  UpdateTeamCycleConfigUseCase,
} from '@application/cycles/use-cases/cycle.use-cases';
import { CycleSchedulerService } from '@application/cycles/services/cycle-scheduler.service';
import { RecordActivityUseCase } from './record-activity.use-case';

/**
 * The register of write paths that must leave a trace.
 *
 * Every hook on this branch was tested by constructing the use-case that HAS a
 * hook and asserting the row — so five write paths that had no hook at all
 * (both bulk cycle detaches, a doc's first page, a duplicated doc's pages, a
 * deleted doc's pages, a deleted roadmap's items) sailed through nineteen tasks
 * and their reviews. Nothing enumerated the paths, so nothing could notice an
 * absence.
 *
 * This asserts the one property that absence violates: a class that mutates a
 * tracked entity (issue · doc page · roadmap item) takes a
 * `RecordActivityUseCase`. It is a coarse check — it proves the collaborator is
 * injected, not that it is called correctly, which is what the per-path specs
 * next to each use-case do. Its job is to make "I forgot entirely" impossible.
 *
 * ADD TO THIS LIST when you add a use-case that writes an issue, a doc page or
 * a roadmap item. If a new write path genuinely records nothing, say so here in
 * a comment rather than leaving it off the list silently.
 */
const WRITE_PATHS: [string, new (...args: never[]) => unknown][] = [
  // issues
  ['CreateIssueUseCase', CreateIssueUseCase],
  ['UpdateIssueUseCase', UpdateIssueUseCase],
  ['SetIssueStatusUseCase', SetIssueStatusUseCase],
  ['DeleteIssueUseCase', DeleteIssueUseCase],
  // docs — the container-level three all mutate pages
  ['CreateDocUseCase', CreateDocUseCase],
  ['DuplicateDocUseCase', DuplicateDocUseCase],
  ['DeleteDocUseCase', DeleteDocUseCase],
  ['CreateDocPageUseCase', CreateDocPageUseCase],
  ['UpdateDocPageUseCase', UpdateDocPageUseCase],
  ['DeleteDocPageUseCase', DeleteDocPageUseCase],
  ['ReorderDocPagesUseCase', ReorderDocPagesUseCase],
  ['RestoreDocPageVersionUseCase', RestoreDocPageVersionUseCase],
  // roadmaps — items are embedded, so the container's delete is a write too
  ['ReplaceRoadmapItemsUseCase', ReplaceRoadmapItemsUseCase],
  ['AddRoadmapItemUseCase', AddRoadmapItemUseCase],
  ['DeleteRoadmapUseCase', DeleteRoadmapUseCase],
  // cycles — both bulk-detach an unbounded number of issues' `cycleId`
  ['DeleteCycleUseCase', DeleteCycleUseCase],
  ['UpdateTeamCycleConfigUseCase', UpdateTeamCycleConfigUseCase],
  // the lazy rollover, the one path allowed to record SYSTEM
  ['CycleSchedulerService', CycleSchedulerService],
];

describe('every write path can record activity', () => {
  it.each(WRITE_PATHS)('%s injects RecordActivityUseCase', (_name, target) => {
    const params = (Reflect.getMetadata('design:paramtypes', target) ?? []) as unknown[];
    expect(params).toContain(RecordActivityUseCase);
  });
});
