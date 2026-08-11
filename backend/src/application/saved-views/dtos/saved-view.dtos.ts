import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { SAVED_VIEW_NAME_MAX } from '@application/saved-views/domain/saved-view.types';

export class CreateSavedViewDto {
  @ApiProperty() @IsString() @MaxLength(SAVED_VIEW_NAME_MAX) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() icon?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() shared?: boolean;
  @ApiProperty() @IsObject() query!: Record<string, unknown>;
}

export class UpdateSavedViewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(SAVED_VIEW_NAME_MAX) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() shared?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsObject() query?: Record<string, unknown>;
}

export class ReorderSavedViewsDto {
  @ApiProperty({ type: [String] }) @IsString({ each: true }) ids!: string[];
}
