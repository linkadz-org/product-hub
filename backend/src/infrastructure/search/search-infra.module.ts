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
