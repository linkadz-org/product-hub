import { Module } from '@nestjs/common';
import { ApplicationSavedViewsModule } from '@application/saved-views/saved-views.module';
import { SavedViewsController } from './saved-views.controller';

@Module({
  imports: [ApplicationSavedViewsModule],
  controllers: [SavedViewsController],
})
export class SavedViewsPresentationModule {}
