import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { PaginationDto } from '@module-shared/modules/pagination/pagination.dto';
import { IIssueRepository } from '@application/issues/repositories/issue.repository';
import { IDocPageRepository } from '@application/docs/repositories/doc-page.repository';
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
 * v1 knows how to guard `AuditEntity.ISSUE` and `AuditEntity.DOC_PAGE` —
 * roadmap items arrive in a later task. Any other entity kind is refused
 * outright rather than queried without a check.
 */
@Injectable()
export class GetActivityUseCase
  implements IUsecaseExecute<GetActivityRequest, Result<AuditLogPaginationResponse>>
{
  constructor(
    @Inject(IAuditLogRepository) private readonly audit: IAuditLogRepository,
    @Inject(IIssueRepository) private readonly issues: IIssueRepository,
    @Inject(IDocPageRepository) private readonly docPages: IDocPageRepository,
  ) {}

  async execute({
    tenantId,
    requesterId,
    isAdmin,
    entity,
    entityId,
    query,
  }: GetActivityRequest): Promise<Result<AuditLogPaginationResponse>> {
    if (entity === AuditEntity.ISSUE) {
      const issue = await this.issues.findById(entityId);
      if (!issue || issue.tenantId !== tenantId) return Result.fail('Not found');
      if (!issue.isVisibleTo(requesterId, isAdmin)) return Result.fail('Not found');
    } else if (entity === AuditEntity.DOC_PAGE) {
      // Same guard as the authenticated page-detail endpoint
      // (GetDocPageUseCase): tenant match, nothing looser. Docs have no
      // per-user visibility rule, but a public share token is a *different*,
      // unauthenticated route that never reaches this session-guarded
      // use-case — so tenant match alone is already "can read this the way
      // the page-detail endpoint would let you".
      const page = await this.docPages.findById(entityId);
      if (!page || page.tenantId !== tenantId) return Result.fail('Not found');
    } else {
      return Result.fail('Not found');
    }

    const result = await this.audit.findByEntities(tenantId, [{ entity, entityId }], query);
    return Result.ok(result);
  }
}
