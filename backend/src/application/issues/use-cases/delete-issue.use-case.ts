import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { RecordActivityUseCase } from '@application/audit-log/use-cases';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { IssueKind } from '../domain/enums/issue.enums';
import { IIssueRepository } from '../repositories/issue.repository';

export interface DeleteIssueRequest {
  id: string;
  tenantId: string;
  /** The caller — a personal task is only deletable by its owner or an admin. */
  requesterId: string;
  /** Display name of the caller — recorded on history rows. */
  requesterName: string;
  isAdmin: boolean;
  /** Deleting a *bug* is restricted to admin/product (mirrors the old bug rule). */
  canDeleteBug: boolean;
}

@Injectable()
export class DeleteIssueUseCase implements IUsecaseExecute<DeleteIssueRequest, Result<void>> {
  constructor(
    @Inject(IIssueRepository) private readonly issues: IIssueRepository,
    private readonly activity: RecordActivityUseCase,
  ) {}

  async execute({
    id,
    tenantId,
    requesterId,
    requesterName,
    isAdmin,
    canDeleteBug,
  }: DeleteIssueRequest): Promise<Result<void>> {
    const issue = await this.issues.findById(id);
    if (!issue || issue.tenantId !== tenantId) return Result.fail('Issue not found');
    // A bug may only be deleted by admin/product (the broader board write roles can
    // create and edit bugs, but not delete them).
    if (issue.kind === IssueKind.BUG && !canDeleteBug) return Result.fail('Issue not found');
    // A personal task can only be deleted by its owner (or an admin).
    if (!issue.isVisibleTo(requesterId, isAdmin)) return Result.fail('Issue not found');
    // Captured before the delete — the entity is gone afterwards, but the row
    // has to outlive it.
    const deletedRef = issue.shortId || issue.id.toString();
    await this.issues.delete(id);

    await this.activity.execute({
      tenantId,
      entity: AuditEntity.ISSUE,
      entityId: id,
      entityRef: deletedRef,
      actor: { type: AuditActor.USER, id: requesterId, name: requesterName },
      changes: [{ field: 'deleted', oldValue: '', newValue: '' }],
    });

    return Result.ok();
  }
}
