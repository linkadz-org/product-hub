import { Module } from '@nestjs/common';
import { InfrastructureAuditLogModule } from '@infrastructure/audit-log/audit-log.module';
import { InfrastructureIssuesModule } from '@infrastructure/issues/issues.module';
import { InfrastructureDocsModule } from '@infrastructure/docs/docs.module';
import { InfrastructureRoadmapsModule } from '@infrastructure/roadmaps/roadmaps.module';
import { GetAuditLogUseCase, RecordActivityUseCase, GetActivityUseCase } from './use-cases';

@Module({
  // GetActivityUseCase guards issue/doc-page/roadmap-item history behind
  // IIssueRepository / IDocPageRepository / IRoadmapRepository, so this module
  // also pulls in each slice's infra directly (not
  // ApplicationIssuesModule/ApplicationDocsModule/ApplicationRoadmapsModule,
  // which all import this module — that would be circular).
  imports: [
    InfrastructureAuditLogModule,
    InfrastructureIssuesModule,
    InfrastructureDocsModule,
    InfrastructureRoadmapsModule,
  ],
  providers: [GetAuditLogUseCase, RecordActivityUseCase, GetActivityUseCase],
  // Export the infra module too so other slices (reports) can inject the port.
  exports: [
    GetAuditLogUseCase,
    RecordActivityUseCase,
    GetActivityUseCase,
    InfrastructureAuditLogModule,
  ],
})
export class ApplicationAuditLogModule {}
