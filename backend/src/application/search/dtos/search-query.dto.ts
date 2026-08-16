import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { TransformQueryArray } from '@module-shared/utils/query-array.util';
import { SearchType } from '../domain/enums/search-type.enum';

export class SearchQueryDto {
  // GlobalSearchUseCase itself early-returns below 2 chars and truncates above 64
  // (see MIN_Q/MAX_Q there), but that still means a bad request quietly walks
  // every repository or gets silently clamped. Reject it here instead so the
  // caller gets a 400, not an empty 200.
  @ApiProperty({ description: 'Chuỗi tìm kiếm thô; server tự chuẩn hoá', minLength: 2, maxLength: 64 })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  q!: string;

  @ApiPropertyOptional({ enum: SearchType, isArray: true })
  @IsOptional()
  @TransformQueryArray()
  @IsArray()
  @IsEnum(SearchType, { each: true })
  types?: SearchType[];

  @ApiPropertyOptional({ default: 8, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
