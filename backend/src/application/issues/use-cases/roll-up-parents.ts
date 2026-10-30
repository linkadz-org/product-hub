import { RecordActivityUseCase } from '@application/audit-log/use-cases';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { autoStatusFor } from '../domain/issue-progress';
import { IIssueRepository } from '../repositories/issue.repository';

/**
 * How far up a chain one move is allowed to cascade.
 *
 * Nesting is a bare `parentId`, so a chain that loops (a corrupt row, a direct
 * DB edit) would otherwise walk forever inside a request. Real nesting is one or
 * two deep; five is a ceiling nobody reaches and a loop hits immediately.
 */
const MAX_PARENT_DEPTH = 5;

export interface RollUpContext {
  tenantId: string;
  requesterId: string;
  requesterName: string;
  actorType?: AuditActor;
}

/**
 * Bring `parentId` — and everything above it — back in step with its children:
 * once every sub-task is done the parent moves to Done on its own, and while one
 * is open the parent comes back out of Done.
 *
 * Any write that changes *which* children a parent has, or what state they are
 * in, has to call this — not only a status move. It used to live inside
 * `SetIssueStatusUseCase` alone, so a sub-task re-parented (or created) under a
 * finished parent left that parent sitting in Done over open work: the backlog
 * item read 88% while every row on its panel showed done, because the two open
 * tasks were folded away under a "done" parent.
 *
 * Only ever moves a parent *between the two built-in* keys `autoStatusFor` can
 * name — a parent parked in a team's custom column is left alone on the way to
 * Done, and is only pulled out of Done, never into some column the team means
 * something specific by.
 *
 * Failing here must not fail the write the user actually asked for: the child is
 * already saved and acknowledged. Hence the guard rails — a depth cap and a
 * visited set — rather than a transaction.
 */
export async function rollUpToParents(
  issues: IIssueRepository,
  activity: RecordActivityUseCase,
  parentId: string | undefined,
  ctx: RollUpContext,
): Promise<void> {
  const seen = new Set<string>();

  for (let depth = 0; depth < MAX_PARENT_DEPTH && parentId; depth += 1) {
    if (seen.has(parentId)) return;
    seen.add(parentId);

    const parent = await issues.findById(parentId);
    if (!parent || parent.tenantId !== ctx.tenantId) return;

    const rollups = await issues.childRollups(ctx.tenantId, [parentId]);
    const rollup = rollups[parentId];
    const next = rollup ? autoStatusFor(parent.kind, parent.status, rollup) : null;
    // Nothing to do here — and nothing above can have changed either, because
    // this parent's own status is what its parent rolls up from.
    if (!next) return;

    const from = parent.status;
    parent.setStatus(next);
    await issues.update(parent);

    // A cascade a person caused keeps that person as the actor — it is their
    // write that moved the parent — with `automated` marking that they never
    // touched this card themselves. See AuditActor: only a change with no human
    // behind it is SYSTEM.
    await activity.execute({
      tenantId: ctx.tenantId,
      entity: AuditEntity.ISSUE,
      entityId: parent.id.toString(),
      entityRef: parent.shortId || parent.id.toString(),
      actor: {
        type: ctx.actorType ?? AuditActor.USER,
        id: ctx.requesterId,
        name: ctx.requesterName,
      },
      automated: true,
      changes: [{ field: 'status', oldValue: from, newValue: next }],
    });

    parentId = parent.parentId;
  }
}
