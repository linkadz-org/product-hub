import { Module } from '@nestjs/common';
import { InfrastructureRoadmapsModule } from '@infrastructure/roadmaps/roadmaps.module';
import { ApplicationAuditLogModule } from '@application/audit-log/audit-log.module';
import {
  CreateRoadmapUseCase,
  GetRoadmapsUseCase,
  GetRoadmapUseCase,
  UpdateRoadmapUseCase,
  ReplaceRoadmapItemsUseCase,
  AddRoadmapItemUseCase,
  ReplaceRoadmapColumnsUseCase,
  DeleteRoadmapUseCase,
  SetRoadmapSharingUseCase,
  GetPublicRoadmapUseCase,
} from './use-cases/roadmap.use-cases';

const useCases = [
  CreateRoadmapUseCase,
  GetRoadmapsUseCase,
  GetRoadmapUseCase,
  UpdateRoadmapUseCase,
  ReplaceRoadmapItemsUseCase,
  AddRoadmapItemUseCase,
  ReplaceRoadmapColumnsUseCase,
  DeleteRoadmapUseCase,
  SetRoadmapSharingUseCase,
  GetPublicRoadmapUseCase,
];

@Module({
  imports: [InfrastructureRoadmapsModule, ApplicationAuditLogModule],
  providers: [...useCases],
  exports: [...useCases],
})
export class ApplicationRoadmapsModule {}
