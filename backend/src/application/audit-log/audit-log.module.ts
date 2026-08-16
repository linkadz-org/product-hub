import { Module } from '@nestjs/common';
import { InfrastructureAuditLogModule } from '@infrastructure/audit-log/audit-log.module';
import { InfrastructureIssuesModule } from '@infrastructure/issues/issues.module';
import { InfrastructureDocsModule } from '@infrastructure/docs/docs.module';
import { GetAuditLogUseCase, RecordActivityUseCase, GetActivityUseCase } from './use-cases';

@Module({
  // GetActivityUseCase guards issue/doc-page history behind IIssueRepository /
  // IDocPageRepository, so this module also pulls in each slice's infra directly
  // (not ApplicationIssuesModule/ApplicationDocsModule, which both import this
  // module — that would be circular).
  imports: [InfrastructureAuditLogModule, InfrastructureIssuesModule, InfrastructureDocsModule],
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
