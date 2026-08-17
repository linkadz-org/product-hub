import { Module } from '@nestjs/common';
import { SearchModule as SearchAppModule } from '@application/search/search.module';
import { SearchController } from './search.controller';

@Module({
  imports: [SearchAppModule],
  controllers: [SearchController],
})
export class SearchPresentationModule {}
