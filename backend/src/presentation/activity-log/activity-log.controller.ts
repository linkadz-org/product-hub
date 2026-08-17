import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '@core/decorators';
import { JwtPayload, Role } from '@core/interfaces';
import { EntityNotFoundException } from '@core/exceptions';
import { IServiceListResponse, ServiceResponse } from '@core/helpers';
import { PaginationDto } from '@module-shared/modules/pagination/pagination.dto';
import { GetActivityUseCase } from '@application/audit-log/use-cases';
import { ActivityQueryDto } from '@application/audit-log/dtos/activity-query.dto';
import { ActivityEntryDto } from '@application/audit-log/dtos/activity-entry.response.dto';
import { ActivityMapper } from '@application/audit-log/mappers';

@ApiTags('Activity')
@ApiBearerAuth('JWT-auth')
@Controller('activity')
export class ActivityLogController {
  constructor(private readonly getActivity: GetActivityUseCase) {}

  @Get()
  @ApiOperation({ summary: "One object's change history (behind its own visibility guard)" })
  async list(
    @AuthUser() auth: JwtPayload,
    @Query() query: ActivityQueryDto,
  ): Promise<IServiceListResponse<ActivityEntryDto> & { relatedTruncated: boolean }> {
    const result = await this.getActivity.execute({
      tenantId: auth.tenantId,
      requesterId: auth.userId,
      isAdmin: auth.role === Role.ADMIN,
      entity: query.entity,
      entityId: query.entityId,
      query: Object.assign(new PaginationDto(), { page: query.page, limit: query.limit }),
    });
    // The use-case deliberately returns the same failure ('Not found') whether
    // the object doesn't exist, belongs to another tenant, or the caller can't
    // see it — never distinguishing those cases so a 404 can't be used to probe
    // for objects the caller isn't allowed to know about.
    if (result.isFailure) throw new EntityNotFoundException(result.error as string);

    const { data, total, page, limit, labelByEntityId, relatedTruncated } = result.getValue();
    return {
      ...ServiceResponse.paginate(ActivityMapper.toDtoArray(data, labelByEntityId), total, page, limit),
      relatedTruncated,
    };
  }
}
