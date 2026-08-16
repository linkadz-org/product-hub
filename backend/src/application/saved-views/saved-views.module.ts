import { Module } from '@nestjs/common';
import { InfrastructureSavedViewsModule } from '@infrastructure/saved-views/saved-views.module';
import {
  CreateSavedViewUseCase,
  ListSavedViewsUseCase,
  UpdateSavedViewUseCase,
  DeleteSavedViewUseCase,
  ReorderSavedViewsUseCase,
} from './use-cases/saved-view.use-cases';

const useCases = [
  CreateSavedViewUseCase,
  ListSavedViewsUseCase,
  UpdateSavedViewUseCase,
  DeleteSavedViewUseCase,
  ReorderSavedViewsUseCase,
];

@Module({
  imports: [InfrastructureSavedViewsModule],
  providers: [...useCases],
  exports: [...useCases],
})
export class ApplicationSavedViewsModule {}
