import { Module } from '@nestjs/common';
import { InfrastructureAuditLogModule } from '@infrastructure/audit-log/audit-log.module';
import { InfrastructureIssuesModule } from '@infrastructure/issues/issues.module';
import { GetAuditLogUseCase, RecordActivityUseCase, GetActivityUseCase } from './use-cases';

@Module({
  // GetActivityUseCase guards issue history behind IIssueRepository, so this
  // module also pulls in the issues infra directly (not ApplicationIssuesModule,
  // which itself imports this module — that would be circular).
  imports: [InfrastructureAuditLogModule, InfrastructureIssuesModule],
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
