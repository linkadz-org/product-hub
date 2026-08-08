/**
 * Enums for the unified **Issue** — the one concept that replaces the separate
 * Task and Bug. An issue's `kind` says which it is; the rest of the vocabulary
 * (statuses, severity, estimate scale) is shared with, and re-exported from, the
 * original task/bug enum homes so there is a single source of truth during the
 * migration.
 *
 * NOTE (cleanup): when the old `tasks`/`bugs` modules are retired, move those enum
 * *definitions* into this file and repoint the few external importers (teams,
 * roadmaps, activity, backfills). Re-exporting keeps them from drifting until then.
 */
export enum IssueKind {
  TASK = 'task',
  BUG = 'bug',
}

export const ISSUE_KINDS: IssueKind[] = [IssueKind.TASK, IssueKind.BUG];

// Shared status/severity vocabulary — re-exported, not redefined (see note above).
export {
  TaskStatus,
  TASK_STATUSES,
  TASK_ESTIMATE_VALUES,
} from '@application/tasks/domain/enums/task.enums';
export {
  BugStatus,
  BUG_STATUSES,
  BugSeverity,
  BUG_SEVERITIES,
} from '@application/bugs/domain/enums/bug.enums';

export type { TaskStatusConfig } from '@application/tasks/domain/enums/task.enums';
export type { BugStatusConfig, BugAttachment } from '@application/bugs/domain/enums/bug.enums';

import { TaskStatus as TaskStatusEnum } from '@application/tasks/domain/enums/task.enums';
import { BugStatus as BugStatusEnum } from '@application/bugs/domain/enums/bug.enums';

/**
 * The statuses that count as **finished**, per kind — the single source of truth
 * for "this issue is done". Statuses have no done-category yet, so this reads the
 * built-in keys literally: an issue parked in a team's *custom* column counts as
 * unfinished. Cycle rollups/rollover (`completedStatusKeysFor`) and the issue's
 * own `resolvedAt` stamp both read this, so a bug can never be "solved" for one
 * and open for the other.
 */
export const COMPLETED_STATUS_KEYS: Record<IssueKind, string[]> = {
  [IssueKind.BUG]: [BugStatusEnum.RESOLVED, BugStatusEnum.CLOSED],
  [IssueKind.TASK]: [TaskStatusEnum.DONE],
};

/** Whether `status` means "finished" for this kind of issue. */
export function isCompletedStatus(kind: IssueKind, status: string): boolean {
  return COMPLETED_STATUS_KEYS[kind].includes(status);
}

/**
 * The **fallback** prefix for an issue that has no team prefix to mint from.
 *
 * A ref no longer says what kind of issue it is: it carries the owning *team's*
 * prefix (`ENG-14`, `QC-8`), and a team's tasks and bugs share one sequence. These
 * two values are only reached in the two cases where there is no team prefix:
 *
 *  - a **personal task**, which lives in no team at all;
 *  - a team from a build that predates ref prefixes, whose backfill has not run
 *    yet — code ships before the backfill does.
 *
 * They are also the prefixes every historical ref was minted under, which is why
 * they stay reserved and why the ref parser still recognises them.
 */
export const ISSUE_REF_PREFIX: Record<IssueKind, string> = {
  [IssueKind.TASK]: 'TSK',
  [IssueKind.BUG]: 'BUG',
};
