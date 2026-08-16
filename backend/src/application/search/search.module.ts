import { Module } from '@nestjs/common';
import { SearchInfraModule } from '@infrastructure/search/search-infra.module';
import { GlobalSearchUseCase } from './use-cases';

@Module({
  imports: [SearchInfraModule],
  providers: [GlobalSearchUseCase],
  exports: [GlobalSearchUseCase],
})
export class SearchModule {}
