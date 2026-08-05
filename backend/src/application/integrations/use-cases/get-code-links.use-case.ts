import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { ICodeLinkRepository } from '../repositories/code-link.repository';
import { CodeLinkMapper } from '../mappers/code-link.mapper';
import { CodeLinkResponseDto } from '../dtos/code-link.dtos';

export interface GetCodeLinksRequest {
  tenantId: string;
  /** An issue id or a backlog item id — both are uuids, and the row knows which. */
  subjectId: string;
}

/**
 * The commits and pull requests attached to one task, bug or backlog item,
 * newest work first.
 *
 * Tenant-scoped at the query, which is also the whole authorisation story: ids
 * are uuids, and one from another workspace simply matches nothing.
 */
@Injectable()
export class GetCodeLinksUseCase
  implements IUsecaseExecute<GetCodeLinksRequest, Result<CodeLinkResponseDto[]>>
{
  constructor(@Inject(ICodeLinkRepository) private readonly links: ICodeLinkRepository) {}

  async execute(req: GetCodeLinksRequest): Promise<Result<CodeLinkResponseDto[]>> {
    if (!req.subjectId) return Result.ok([]);
    const rows = await this.links.findForSubject(req.tenantId, req.subjectId);
    return Result.ok(rows.map((r) => CodeLinkMapper.toResponseDto(r)));
  }
}
