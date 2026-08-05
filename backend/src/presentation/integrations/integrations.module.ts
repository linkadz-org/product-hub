import { Module } from '@nestjs/common';
import { ApplicationIntegrationsModule } from '@application/integrations/integrations.module';
import { GitHubWebhookController } from './github-webhook.controller';
import { CodeLinksController } from './code-links.controller';

@Module({
  imports: [ApplicationIntegrationsModule],
  controllers: [GitHubWebhookController, CodeLinksController],
})
export class IntegrationsPresentationModule {}
