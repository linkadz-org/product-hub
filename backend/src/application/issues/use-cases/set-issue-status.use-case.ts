import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { RecordActivityUseCase } from '@application/audit-log/use-cases';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { IssueEntity } from '../domain/entities/issue.entity';
import { IIssueRepository } from '../repositories/issue.repository';

export interface SetIssueStatusRequest {
  id: string;
  tenantId: string;
  /** The caller — a personal task is only movable by its owner or an admin. */
  requesterId: string;
  /** Display name of the caller — recorded on history rows. */
  requesterName: string;
  /** Defaults to USER. MCP passes API so a bot is distinguishable from a person. */
  actorType?: AuditActor;
  isAdmin: boolean;
  status: string;
}

/** Move an issue to another status column (Kanban drag). */
@Injectable()
export class SetIssueStatusUseCase
  implements IUsecaseExecute<SetIssueStatusRequest, Result<IssueEntity>>
{
  constructor(
    @Inject(IIssueRepository) private readonly issues: IIssueRepository,
    private readonly activity: RecordActivityUseCase,
  ) {}

  async execute({
    id,
    tenantId,
    requesterId,
    requesterName,
    actorType,
    isAdmin,
    status,
  }: SetIssueStatusRequest): Promise<Result<IssueEntity>> {
    const issue = await this.issues.findById(id);
    if (!issue || issue.tenantId !== tenantId) return Result.fail('Issue not found');
    // A personal task can only be moved by its owner (or an admin).
    if (!issue.isVisibleTo(requesterId, isAdmin)) return Result.fail('Issue not found');
    const oldStatus = issue.status;
    issue.setStatus(status);
    await this.issues.update(issue);

    await this.activity.execute({
      tenantId,
      entity: AuditEntity.ISSUE,
      entityId: issue.id.toString(),
      entityRef: issue.shortId || issue.id.toString(),
      actor: { type: actorType ?? AuditActor.USER, id: requesterId, name: requesterName },
      changes:
        oldStatus === status
          ? []
          : [{ field: 'status', oldValue: oldStatus, newValue: status }],
    });

    return Result.ok(issue);
  }
}
