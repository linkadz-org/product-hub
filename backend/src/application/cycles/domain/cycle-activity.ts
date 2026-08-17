import { MovedIssue } from '@application/issues/repositories/issue.repository';
import { AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import {
  ActivityActor,
  RecordActivityUseCase,
} from '@application/audit-log/use-cases/record-activity.use-case';

/**
 * Log a bulk `cycleId` change — the one place every cycle sweep writes history.
 *
 * There are two of them and they must not diverge: the date-driven rollover
 * (`cycle-scheduler.service.ts`, nobody acted → SYSTEM) and the admin actions
 * that detach issues wholesale (deleting a cycle, changing a team's rhythm,
 * turning cycles off — a real person acted, so they keep their identity and the
 * rows are marked `automated`). Before this existed only the first was logged,
 * so "why did QC-42 fall out of Cycle 3?" was answerable exactly when the
 * answer was "the clock" and unanswerable when it was "an admin".
 *
 * `at` is passed in and shared by every row so the UI can group one sweep into
 * a single "N issues moved" entry.
 */
export async function recordCycleIdChanges(
  activity: RecordActivityUseCase,
  tenantId: string,
  at: Date,
  moved: MovedIssue[],
  actor: ActivityActor,
  automated: boolean,
): Promise<void> {
  for (const m of moved) {
    await activity.execute({
      tenantId,
      entity: AuditEntity.ISSUE,
      entityId: m.id,
      entityRef: m.shortId || m.id,
      actor,
      automated,
      at,
      changes: [{ field: 'cycleId', oldValue: m.fromCycleId, newValue: m.toCycleId }],
    });
  }
}
