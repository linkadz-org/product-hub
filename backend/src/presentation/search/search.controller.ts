import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '@core/decorators';
import { JwtPayload } from '@core/interfaces';
import { GlobalSearchUseCase } from '@application/search/use-cases';
import { SearchQueryDto } from '@application/search/dtos/search-query.dto';

@ApiTags('Search')
@ApiBearerAuth('JWT-auth')
@Controller('search')
export class SearchController {
  constructor(private readonly globalSearch: GlobalSearchUseCase) {}

  @Get()
  @ApiOperation({ summary: 'Tìm kiếm toàn workspace' })
  async search(@AuthUser() auth: JwtPayload, @Query() query: SearchQueryDto) {
    return this.globalSearch.execute({
      tenantId: auth.tenantId,
      q: query.q,
      types: query.types,
      limit: query.limit,
    });
  }
}
