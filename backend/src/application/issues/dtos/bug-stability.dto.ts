import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TransformQueryArray } from '@module-shared/utils/query-array.util';
import {
  DEFAULT_STABILITY_PERIODS,
  DEFAULT_STABILITY_SEVERITIES,
  MAX_STABILITY_PERIODS,
  STABILITY_PERIOD_DAYS,
  StabilityVerdict,
} from '../domain/bug-stability';
import { BugSeverity } from '../domain/enums/issue.enums';

/** Query for `GET /issues/stability`. */
export class QueryBugStabilityDto {
  @ApiPropertyOptional({ description: "Scope to one team's bug list (a team board)" })
  @IsOptional()
  @IsString()
  teamId?: string;

  @ApiPropertyOptional({ description: 'Scope to one project' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Length of one period. Sized in working days when skipWeekends is set.',
    enum: STABILITY_PERIOD_DAYS,
    default: 7,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(STABILITY_PERIOD_DAYS as unknown as number[])
  periodDays?: number = 7;

  @ApiPropertyOptional({
    description: 'How many periods to draw, newest last',
    default: DEFAULT_STABILITY_PERIODS,
    minimum: 2,
    maximum: MAX_STABILITY_PERIODS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(MAX_STABILITY_PERIODS)
  periods?: number = DEFAULT_STABILITY_PERIODS;

  @ApiPropertyOptional({
    enum: BugSeverity,
    isArray: true,
    description:
      'Which severities to count, as `?severities=critical&severities=high` (or comma-joined). ' +
      'Critical + high by default — the two that decide whether a build is shippable.',
    default: DEFAULT_STABILITY_SEVERITIES,
  })
  @IsOptional()
  @TransformQueryArray()
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(BugSeverity, { each: true })
  severities?: BugSeverity[] = DEFAULT_STABILITY_SEVERITIES;

  @ApiPropertyOptional({
    description:
      'Size periods in working days (Mon–Fri) so every bar covers the same amount of ' +
      'testing time. Bugs logged at the weekend still count, in the period spanning it.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  skipWeekends?: boolean = false;

  @ApiPropertyOptional({
    description:
      "Last day of the newest period, YYYY-MM-DD. Send the viewer's own today so " +
      'the windows line up with their calendar; defaults to the server’s.',
    example: '2026-09-07',
  })
  @IsOptional()
  @IsISO8601()
  until?: string;
}

/** One period on the x-axis. */
export class BugStabilityPointDto {
  @ApiProperty({ description: 'Inclusive first day, YYYY-MM-DD' })
  start: string;

  @ApiProperty({ description: 'Inclusive last day, YYYY-MM-DD' })
  end: string;

  @ApiProperty({ description: 'Calendar days spanned (> periodDays when weekends are skipped)' })
  days: number;

  @ApiProperty({ description: 'Critical bugs opened in the period (P0)' })
  openedCritical: number;

  @ApiProperty({ description: 'High bugs opened in the period (P1)' })
  openedHigh: number;

  @ApiProperty({ description: 'Medium bugs opened in the period; 0 unless medium is counted' })
  openedMedium: number;

  @ApiProperty({ description: 'Low bugs opened in the period; 0 unless low is counted' })
  openedLow: number;

  @ApiProperty({ description: 'The four counts added up — the bar’s height' })
  opened: number;

  @ApiProperty({ description: 'Counted bugs resolved during the period' })
  resolved: number;

  @ApiProperty({ description: 'Counted bugs still open on the period’s last day, however old' })
  openAtEnd: number;
}

/**
 * The stability read-out: bugs of the requested severities opened per period
 * (critical + high by default, read as P0 + P1), with the standing open count
 * behind them. See `domain/bug-stability.ts` for what each number means and why
 * both series are needed to call a trend.
 */
export class BugStabilityResponseDto {
  @ApiProperty()
  periodDays: number;

  @ApiProperty()
  skipWeekends: boolean;

  @ApiProperty({
    enum: BugSeverity,
    isArray: true,
    description: 'The severities these numbers cover, most serious first (the stacking order)',
  })
  severities: string[];

  @ApiProperty({ type: [BugStabilityPointDto], description: 'Oldest → newest' })
  series: BugStabilityPointDto[];

  @ApiProperty({ description: 'Counted bugs opened across the whole window' })
  totalOpened: number;

  @ApiProperty({ description: 'Counted bugs still open on the final day' })
  openNow: number;

  @ApiProperty({
    description:
      'Slope of the opened series as a fraction of its mean per period; negative = falling',
  })
  openedTrend: number;

  @ApiProperty({ description: 'The same slope over the still-open series' })
  openTrend: number;

  @ApiProperty({
    enum: ['improving', 'steady', 'worsening', 'insufficient'],
    description: 'Both slopes read together; `insufficient` when there is too little data to call',
  })
  verdict: StabilityVerdict;
}
