import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ICodeLinkRepository } from '@application/integrations/repositories/code-link.repository';
import { CodeLinkSchema } from './entities/code-link.schema';
import { CodeLinkRepository } from './repositories/code-link.repository';

@Module({
  imports: [MongooseModule.forFeature([{ name: 'CodeLink', schema: CodeLinkSchema }])],
  providers: [{ provide: ICodeLinkRepository, useClass: CodeLinkRepository }],
  exports: [ICodeLinkRepository],
})
export class InfrastructureIntegrationsModule {}
