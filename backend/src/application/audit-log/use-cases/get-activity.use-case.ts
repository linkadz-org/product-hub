import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { PaginationDto } from '@module-shared/modules/pagination/pagination.dto';
import { IIssueRepository } from '@application/issues/repositories/issue.repository';
import { IDocPageRepository } from '@application/docs/repositories/doc-page.repository';
import { IRoadmapRepository } from '@application/roadmaps/repositories/roadmap.repository';
import { IReportRepository } from '@application/reports/repositories/report.repository';
import { AuditEntity } from '../domain/enums/audit.enums';
import {
  AuditEntityRef,
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

export interface GetActivityResponse extends AuditLogPaginationResponse {
  /** `relationLabel` for each row, keyed by `entityId` — one merged query
   *  carries different labels per row, so this rides alongside `data` rather
   *  than the mapper being called once per group. */
  labelByEntityId: Record<string, string>;
  /** True when more than `MAX_RELATED` related objects existed and only the
   *  most recently updated ones were queried. Silently dropping the rest
   *  would lie to the reader, so this is surfaced instead. */
  relatedTruncated: boolean;
}

/** Hard cap on how many related objects feed into one timeline read. */
const MAX_RELATED = 50;

interface RelatedCandidate {
  ref: AuditEntityRef;
  label: string;
  updatedAt: Date;
}

/**
 * Reads one object's history behind its own permission guard.
 *
 * Knows how to guard `AuditEntity.ISSUE`, `AuditEntity.DOC_PAGE` and
 * `AuditEntity.ROADMAP_ITEM`. Any other entity kind is refused outright
 * rather than queried without a check.
 *
 * For an issue, the timeline additionally pulls in the history of the things
 * around it — subtasks, attached doc pages, the linked roadmap item, the
 * related test case — assembled at *read* time from the relationships as
 * they stand right now (never denormalized at write time), and each one runs
 * through its own visibility guard before its rows are queried. A related
 * object that no longer exists (deleted subtask, unlinked roadmap item,
 * deleted report) simply drops out of the relationship lookup — it
 * contributes nothing, but nothing throws.
 */
@Injectable()
export class GetActivityUseCase
  implements IUsecaseExecute<GetActivityRequest, Result<GetActivityResponse>>
{
  constructor(
    @Inject(IAuditLogRepository) private readonly audit: IAuditLogRepository,
    @Inject(IIssueRepository) private readonly issues: IIssueRepository,
    @Inject(IDocPageRepository) private readonly docPages: IDocPageRepository,
    @Inject(IRoadmapRepository) private readonly roadmaps: IRoadmapRepository,
    @Inject(IReportRepository) private readonly reports: IReportRepository,
  ) {}

  async execute({
    tenantId,
    requesterId,
    isAdmin,
    entity,
    entityId,
    query,
  }: GetActivityRequest): Promise<Result<GetActivityResponse>> {
    let relatedRefs: AuditEntityRef[] = [];
    let labelByEntityId: Record<string, string> = {};
    let relatedTruncated = false;

    if (entity === AuditEntity.ISSUE) {
      const issue = await this.issues.findById(entityId);
      if (!issue || issue.tenantId !== tenantId) return Result.fail('Not found');
      if (!issue.isVisibleTo(requesterId, isAdmin)) return Result.fail('Not found');

      const related = await this.gatherRelated(tenantId, requesterId, isAdmin, issue);
      relatedRefs = related.refs;
      labelByEntityId = related.labelByEntityId;
      relatedTruncated = related.truncated;
    } else if (entity === AuditEntity.DOC_PAGE) {
      // Same guard as the authenticated page-detail endpoint
      // (GetDocPageUseCase): tenant match, nothing looser. Docs have no
      // per-user visibility rule, but a public share token is a *different*,
      // unauthenticated route that never reaches this session-guarded
      // use-case — so tenant match alone is already "can read this the way
      // the page-detail endpoint would let you".
      const page = await this.docPages.findById(entityId);
      if (!page || page.tenantId !== tenantId) return Result.fail('Not found');
    } else if (entity === AuditEntity.ROADMAP_ITEM) {
      // Items have no independent access rule — guard on the roadmap that
      // contains them, the same tenant-match guard the authenticated
      // roadmap-detail endpoint uses (GetRoadmapUseCase). `entityId` here is
      // the ITEM's id, so this looks the roadmap up by the item it embeds
      // rather than by its own id.
      const roadmap = await this.roadmaps.findByItemId(tenantId, entityId);
      if (!roadmap || roadmap.tenantId !== tenantId) return Result.fail('Not found');
    } else {
      return Result.fail('Not found');
    }

    const refs: AuditEntityRef[] = [{ entity, entityId }, ...relatedRefs];
    const result = await this.audit.findByEntities(tenantId, refs, query);
    return Result.ok({ ...result, labelByEntityId, relatedTruncated });
  }

  /**
   * Gathers refs for the things around an issue, each behind its own guard:
   * subtasks (`subtask`), attached doc pages (`doc`), the linked roadmap item
   * (`roadmap_item`) and the related test case (`testcase`). Capped at
   * `MAX_RELATED`, keeping the most recently updated when there are more.
   */
  private async gatherRelated(
    tenantId: string,
    requesterId: string,
    isAdmin: boolean,
    issue: { id: { toString(): string }; roadmapItemId: string; reportId: string; caseId: string },
  ): Promise<{ refs: AuditEntityRef[]; labelByEntityId: Record<string, string>; truncated: boolean }> {
    const issueId = issue.id.toString();
    const candidates: RelatedCandidate[] = [];

    const children = await this.issues.findChildren(tenantId, issueId);
    for (const child of children) {
      if (!child.isVisibleTo(requesterId, isAdmin)) continue; // own guard, per child
      candidates.push({
        ref: { entity: AuditEntity.ISSUE, entityId: child.id.toString() },
        label: 'subtask',
        updatedAt: child.updatedAt,
      });
    }

    const pages = await this.docPages.findByLinkRef(tenantId, issueId);
    for (const page of pages) {
      if (page.tenantId !== tenantId) continue; // own guard, per page
      candidates.push({
        ref: { entity: AuditEntity.DOC_PAGE, entityId: page.id.toString() },
        label: 'doc',
        updatedAt: page.updatedAt,
      });
    }

    if (issue.roadmapItemId) {
      const roadmap = await this.roadmaps.findByItemId(tenantId, issue.roadmapItemId);
      if (roadmap && roadmap.tenantId === tenantId) {
        candidates.push({
          ref: { entity: AuditEntity.ROADMAP_ITEM, entityId: issue.roadmapItemId },
          label: 'roadmap_item',
          updatedAt: roadmap.updatedAt,
        });
      }
      // No roadmap embeds this item any more (deleted/unlinked) — drop it
      // silently, same as any other vanished related object.
    }

    if (issue.reportId && issue.caseId) {
      const report = await this.reports.findById(issue.reportId);
      if (report && report.tenantId === tenantId) {
        candidates.push({
          ref: { entity: AuditEntity.TESTCASE, entityId: issue.caseId },
          label: 'testcase',
          updatedAt: report.updatedAt,
        });
      }
      // Report deleted — drop it silently, same as above.
    }

    candidates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const truncated = candidates.length > MAX_RELATED;
    const kept = candidates.slice(0, MAX_RELATED);

    return {
      refs: kept.map((c) => c.ref),
      labelByEntityId: Object.fromEntries(kept.map((c) => [c.ref.entityId, c.label])),
      truncated,
    };
  }
}
