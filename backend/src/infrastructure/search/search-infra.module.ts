import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { IssueSchema } from '@infrastructure/issues/entities/issue.schema';
import { DocSchema } from '@infrastructure/docs/entities/doc.schema';
import { DocPageSchema } from '@infrastructure/docs/entities/doc-page.schema';
import { ProjectSchema } from '@infrastructure/projects/entities/project.schema';
import { ReportSchema } from '@infrastructure/reports/entities/report.schema';
import { RoadmapSchema } from '@infrastructure/roadmaps/entities/roadmap.schema';
import { IssueSearchRepository } from './repositories/issue-search.repository';
import { DocSearchRepository } from './repositories/doc-search.repository';
import { DocPageSearchRepository } from './repositories/doc-page-search.repository';
import { ProjectSearchRepository } from './repositories/project-search.repository';
import { RoadmapItemSearchRepository } from './repositories/roadmap-item-search.repository';
import { ReportSearchRepository, TestCaseSearchRepository } from './repositories/report-search.repository';

/**
 * Honest note on what the `{tenantId, searchText}` / `{tenantId, searchBody}`
 * / `{tenantId, casesSearchText}` / `{tenantId, itemsSearchText}` indexes
 * (defined on each schema, not here) actually buy: they serve *scans*, not
 * *seeks*. Every query here builds an unanchored `RegExp` (`escapeRegex(q)`,
 * no `^`) — Mongo can use a btree index to narrow to the `tenantId` prefix,
 * but it cannot seek *into* that prefix for a substring match, so it still
 * walks every doc in the tenant's slice. That's a meaningfully smaller scan
 * than a full collection scan (bounded by one tenant, not every tenant), but
 * it is not the O(log n) seek an index normally gets you, and it will not
 * scale forever.
 *
 * `ISearchableRepository` is the designed swap point if that stops being
 * good enough: it's already a leaf-level abstraction (one `search()` per
 * source), so replacing this regex approach with a real search engine
 * (Atlas Search, Elasticsearch/OpenSearch, Meilisearch…) behind the same
 * interface would not require touching `GlobalSearchUseCase` or the command
 * palette that consumes it.
 */
// Model token đã kiểm chứng trong các *.module.ts tương ứng (issues, docs,
// projects, reports, roadmaps) — sai tên ở đây là app chết lúc boot chứ không
// phải lúc compile.
const IMPLS = [
  IssueSearchRepository,
  DocSearchRepository,
  DocPageSearchRepository,
  ProjectSearchRepository,
  RoadmapItemSearchRepository,
  ReportSearchRepository,
  TestCaseSearchRepository,
];

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: 'Issue', schema: IssueSchema },
      { name: 'Doc', schema: DocSchema },
      { name: 'DocPage', schema: DocPageSchema },
      { name: 'Project', schema: ProjectSchema },
      { name: 'Report', schema: ReportSchema },
      { name: 'Roadmap', schema: RoadmapSchema },
    ]),
  ],
  providers: [
    ...IMPLS,
    {
      // Gom mọi implementation vào một mảng để use-case inject được cả mảng.
      provide: ISearchableRepository,
      useFactory: (...repos: ISearchableRepository[]) => repos,
      inject: IMPLS,
    },
  ],
  exports: [ISearchableRepository],
})
export class SearchInfraModule {}
