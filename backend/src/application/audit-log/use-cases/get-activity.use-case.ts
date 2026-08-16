import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { PaginationDto } from '@module-shared/modules/pagination/pagination.dto';
import { IIssueRepository } from '@application/issues/repositories/issue.repository';
import { AuditEntity } from '../domain/enums/audit.enums';
import {
  AuditLogPaginationResponse,
  IAuditLogRepository,
} from '../repositories/audit-log.repository';

export interface GetActivityRequest {
  tenantId: string;
  /** The caller — used to run the object's own visibility guard. */
  requesterId: string;
  isAdmin: boolean;
  entity: AuditEntity;
  entityId: string;
  query: PaginationDto;
}

/**
 * Reads one object's history behind its own permission guard.
 *
 * v1 only knows how to guard `AuditEntity.ISSUE` — doc pages and roadmap
 * items arrive in later tasks. Any other entity kind is refused outright
 * rather than queried without a check.
 */
@Injectable()
export class GetActivityUseCase
  implements IUsecaseExecute<GetActivityRequest, Result<AuditLogPaginationResponse>>
{
  constructor(
    @Inject(IAuditLogRepository) private readonly audit: IAuditLogRepository,
    @Inject(IIssueRepository) private readonly issues: IIssueRepository,
  ) {}

  async execute({
    tenantId,
    requesterId,
    isAdmin,
    entity,
    entityId,
    query,
  }: GetActivityRequest): Promise<Result<AuditLogPaginationResponse>> {
    if (entity !== AuditEntity.ISSUE) return Result.fail('Not found');

    const issue = await this.issues.findById(entityId);
    if (!issue || issue.tenantId !== tenantId) return Result.fail('Not found');
    if (!issue.isVisibleTo(requesterId, isAdmin)) return Result.fail('Not found');

    const result = await this.audit.findByEntities(tenantId, [{ entity, entityId }], query);
    return Result.ok(result);
  }
}
