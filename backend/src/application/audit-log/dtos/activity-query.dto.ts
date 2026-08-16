import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsString, Max, Min, MinLength, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditEntity } from '../domain/enums/audit.enums';

export class ActivityQueryDto {
  @ApiProperty({ enum: AuditEntity })
  @IsEnum(AuditEntity)
  entity: AuditEntity;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  entityId: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Runtime default of 50, not just documentation: the repository's own
  // `findByEntities`/`findByProject` fall back to `limit ?? 10` when this is
  // undefined, which would silently contradict the documented default below.
  // Giving the DTO a real default keeps a client that omits `limit` getting
  // what the API says it gets.
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
