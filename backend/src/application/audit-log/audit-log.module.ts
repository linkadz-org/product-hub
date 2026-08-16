import { Module } from '@nestjs/common';
import { InfrastructureAuditLogModule } from '@infrastructure/audit-log/audit-log.module';
import { GetAuditLogUseCase, RecordActivityUseCase } from './use-cases';

@Module({
  imports: [InfrastructureAuditLogModule],
  providers: [GetAuditLogUseCase, RecordActivityUseCase],
  // Export the infra module too so other slices (reports) can inject the port.
  exports: [GetAuditLogUseCase, RecordActivityUseCase, InfrastructureAuditLogModule],
})
export class ApplicationAuditLogModule {}
