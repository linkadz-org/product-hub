import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ISavedViewRepository } from '@application/saved-views/repositories/saved-view.repository';
import { SavedViewSchema } from './entities/saved-view.schema';
import { SavedViewRepository } from './repositories/saved-view.repository';

@Module({
  imports: [MongooseModule.forFeature([{ name: 'SavedView', schema: SavedViewSchema }])],
  providers: [{ provide: ISavedViewRepository, useClass: SavedViewRepository }],
  exports: [ISavedViewRepository],
})
export class InfrastructureSavedViewsModule {}
