import { Module } from '@nestjs/common';
import { ApplicationAuditLogModule } from '@application/audit-log/audit-log.module';
import { ActivityLogController } from './activity-log.controller';

@Module({
  imports: [ApplicationAuditLogModule],
  controllers: [ActivityLogController],
})
export class ActivityLogPresentationModule {}
