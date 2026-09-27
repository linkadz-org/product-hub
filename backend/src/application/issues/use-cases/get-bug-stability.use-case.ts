import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { todayISO } from '@application/cycles/domain/cycle-dates';
import {
  buildStability,
  DEFAULT_STABILITY_PERIODS,
  DEFAULT_STABILITY_SEVERITIES,
} from '../domain/bug-stability';
import { COMPLETED_STATUS_KEYS, IssueKind } from '../domain/enums/issue.enums';
import { QueryBugStabilityDto } from '../dtos/bug-stability.dto';
import { BugStabilityResponseDto } from '../dtos/bug-stability.dto';
import { IIssueRepository } from '../repositories/issue.repository';

export interface GetBugStabilityRequest {
  tenantId: string;
  query: QueryBugStabilityDto;
}

/**
 * "Is the app getting more stable?" — serious bugs per period, over recent
 * history. Thin on purpose: fetch the rows, hand them to the pure builder in
 * `domain/bug-stability.ts`, return the shape the chart draws.
 */
@Injectable()
export class GetBugStabilityUseCase
  implements IUsecaseExecute<GetBugStabilityRequest, Result<BugStabilityResponseDto>>
{
  constructor(@Inject(IIssueRepository) private readonly issues: IIssueRepository) {}

  async execute({ tenantId, query }: GetBugStabilityRequest): Promise<Result<BugStabilityResponseDto>> {
    const periodDays = query.periodDays ?? 7;
    const periods = query.periods ?? DEFAULT_STABILITY_PERIODS;
    const skipWeekends = query.skipWeekends ?? false;
    const severities = query.severities?.length ? query.severities : DEFAULT_STABILITY_SEVERITIES;
    // The client sends its own today so the windows match the calendar the viewer
    // is looking at; the server's date is only the fallback.
    const until = (query.until ?? todayISO()).slice(0, 10);

    const rows = await this.issues.bugsForStability(tenantId, {
      teamId: query.teamId,
      projectId: query.projectId,
      severities,
      // End of the last charted day — a bug filed this afternoon must still land
      // in today's period, so the cut is the day's last instant, not its start.
      until: new Date(`${until}T23:59:59.999Z`),
    });

    return Result.ok(
      buildStability({
        until,
        periodDays,
        periods,
        skipWeekends,
        severities,
        rows,
        completedKeys: COMPLETED_STATUS_KEYS[IssueKind.BUG],
      }),
    );
  }
}
