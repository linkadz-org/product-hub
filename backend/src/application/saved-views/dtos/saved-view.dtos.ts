import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEW_SCOPE_MAX,
  SAVED_VIEW_SCOPE_PATTERN,
} from '@application/saved-views/domain/saved-view.types';

export class CreateSavedViewDto {
  @ApiProperty() @IsString() @MaxLength(SAVED_VIEW_NAME_MAX) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() icon?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() shared?: boolean;
  /**
   * Which board this view belongs to — a *key* (`issues`, `issues-me`,
   * `team:<id>`), never a path. The client resolves it to a URL (see the
   * frontend's `saved-views/scope.ts`), so a value that could shape a link is
   * refused here rather than stored and trusted later: a shared view is written
   * by one user and opened by everyone in the workspace, and `//evil.example`
   * in a path column would be a protocol-relative href — an open redirect with
   * a saved view as the delivery mechanism. The pattern admits no `/`, `:`
   * beyond the single separator, `.` or whitespace, so no URL can survive it.
   * Omitted → the schema default (`issues`), which is what every row written
   * before scopes existed already holds.
   */
  @ApiPropertyOptional({ example: 'team:6f1c…' })
  @IsOptional()
  @IsString()
  @MaxLength(SAVED_VIEW_SCOPE_MAX)
  @Matches(SAVED_VIEW_SCOPE_PATTERN, {
    message: 'scope must be a board key such as "issues", "issues-me" or "team:<id>"',
  })
  scope?: string;
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
