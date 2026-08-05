import { Module } from '@nestjs/common';
import { InfrastructureIntegrationsModule } from '@infrastructure/integrations/integrations.module';
import { InfrastructureAppSettingsModule } from '@infrastructure/app-settings/app-settings.module';
import { InfrastructureIssuesModule } from '@infrastructure/issues/issues.module';
import { InfrastructureRoadmapsModule } from '@infrastructure/roadmaps/roadmaps.module';
import {
  ConnectGitHubUseCase,
  DisconnectGitHubUseCase,
  GetCodeLinksUseCase,
  GetGitHubConnectionUseCase,
  HandleGitHubEventUseCase,
} from './use-cases';

const useCases = [
  HandleGitHubEventUseCase,
  GetCodeLinksUseCase,
  GetGitHubConnectionUseCase,
  ConnectGitHubUseCase,
  DisconnectGitHubUseCase,
];

@Module({
  // Settings holds the connection (and resolves a delivery's workspace); issues
  // and roadmaps are what a ref in a commit message points at.
  imports: [
    InfrastructureIntegrationsModule,
    InfrastructureAppSettingsModule,
    InfrastructureIssuesModule,
    InfrastructureRoadmapsModule,
  ],
  providers: [...useCases],
  exports: [...useCases],
})
export class ApplicationIntegrationsModule {}
