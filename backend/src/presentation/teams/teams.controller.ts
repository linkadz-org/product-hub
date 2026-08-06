import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, Roles } from '@core/decorators';
import { JwtPayload, Role } from '@core/interfaces';
import { EntityNotFoundException } from '@core/exceptions';
import {
  CreateTeamUseCase,
  GetTeamsUseCase,
  UpdateTeamStatusesUseCase,
  UpdateTeamLabelsUseCase,
  UpdateTeamCustomFieldsUseCase,
  UpdateTeamUseCase,
  SetTeamSharingUseCase,
  TEAM_NOT_FOUND,
  ResolveTeamPrefixLockUseCase,
} from '@application/teams/use-cases/team.use-cases';
import {
  CreateTeamDto,
  ShareTeamDto,
  TeamResponseDto,
  UpdateTeamDto,
  UpdateTeamLabelsDto,
  UpdateTeamCustomFieldsDto,
  UpdateTeamStatusesDto,
} from '@application/teams/dtos/team.dtos';
import { TeamMapper } from '@application/teams/mappers/team.mapper';

@ApiTags('Teams')
@ApiBearerAuth('JWT-auth')
@Controller()
export class TeamsController {
  constructor(
    private readonly getTeams: GetTeamsUseCase,
    private readonly createTeam: CreateTeamUseCase,
    private readonly updateTeam: UpdateTeamUseCase,
    private readonly updateStatuses: UpdateTeamStatusesUseCase,
    private readonly updateLabels: UpdateTeamLabelsUseCase,
    private readonly updateCustomFields: UpdateTeamCustomFieldsUseCase,
    private readonly setSharing: SetTeamSharingUseCase,
    private readonly prefixLock: ResolveTeamPrefixLockUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List teams (any authenticated user — drives the nav)' })
  async list(@AuthUser() auth: JwtPayload): Promise<TeamResponseDto[]> {
    const teams = (await this.getTeams.execute({ tenantId: auth.tenantId })).getValue();
    // One batched Promise.all, not a counter read per team inside the map.
    const locked = await this.prefixLock.many(auth.tenantId, teams);
    return TeamMapper.toResponseDtoArray(teams, locked);
  }

  @Post()
  @Roles(Role.ADMIN, Role.PRODUCT)
  @ApiOperation({ summary: 'Add a team' })
  async create(
    @AuthUser() auth: JwtPayload,
    @Body() dto: CreateTeamDto,
  ): Promise<TeamResponseDto> {
    const result = await this.createTeam.execute({ tenantId: auth.tenantId, dto });
    if (result.isFailure) throw new BadRequestException(result.error as string);
    const team = result.getValue();
    return TeamMapper.toResponseDto(team, await this.prefixLock.one(auth.tenantId, team));
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.PRODUCT)
  @ApiOperation({ summary: 'Rename or archive a team (defaults cannot be archived)' })
  async update(
    @AuthUser() auth: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ): Promise<TeamResponseDto> {
    const result = await this.updateTeam.execute({ tenantId: auth.tenantId, id, dto });
    if (result.isFailure) {
      const msg = result.error as string;
      // Only a missing team is a 404. Everything else — a bad rename, an archive
      // of a default team, a frozen or duplicate prefix — is a rejected write, so
      // it must be a 400 the settings form can show against the offending field.
      // This matches every sibling handler below; it used to be the inverse.
      if (msg === TEAM_NOT_FOUND) throw new EntityNotFoundException(msg);
      throw new BadRequestException(msg);
    }
    const team = result.getValue();
    return TeamMapper.toResponseDto(team, await this.prefixLock.one(auth.tenantId, team));
  }

  @Put(':id/statuses')
  @Roles(Role.ADMIN, Role.PRODUCT)
  @ApiOperation({
    summary: "Replace a team's board columns (built-ins can be renamed/reordered, not removed)",
  })
  async setStatuses(
    @AuthUser() auth: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTeamStatusesDto,
  ): Promise<TeamResponseDto> {
    const result = await this.updateStatuses.execute({ tenantId: auth.tenantId, id, dto });
    if (result.isFailure) {
      const msg = result.error as string;
      if (msg === TEAM_NOT_FOUND) throw new EntityNotFoundException(msg);
      throw new BadRequestException(msg);
    }
    const team = result.getValue();
    return TeamMapper.toResponseDto(team, await this.prefixLock.one(auth.tenantId, team));
  }

  @Put(':id/labels')
  @Roles(Role.ADMIN, Role.PRODUCT)
  @ApiOperation({ summary: "Replace a team's item labels (shared by its tasks/bugs; may be empty)" })
  async setLabels(
    @AuthUser() auth: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTeamLabelsDto,
  ): Promise<TeamResponseDto> {
    const result = await this.updateLabels.execute({ tenantId: auth.tenantId, id, dto });
    if (result.isFailure) {
      const msg = result.error as string;
      if (msg === TEAM_NOT_FOUND) throw new EntityNotFoundException(msg);
      throw new BadRequestException(msg);
    }
    const team = result.getValue();
    return TeamMapper.toResponseDto(team, await this.prefixLock.one(auth.tenantId, team));
  }

  @Put(':id/custom-fields')
  @Roles(Role.ADMIN, Role.PRODUCT)
  @ApiOperation({ summary: "Replace a team's custom fields (shared by its tasks/bugs; may be empty)" })
  async setCustomFields(
    @AuthUser() auth: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTeamCustomFieldsDto,
  ): Promise<TeamResponseDto> {
    const result = await this.updateCustomFields.execute({ tenantId: auth.tenantId, id, dto });
    if (result.isFailure) {
      const msg = result.error as string;
      if (msg === TEAM_NOT_FOUND) throw new EntityNotFoundException(msg);
      throw new BadRequestException(msg);
    }
    const team = result.getValue();
    return TeamMapper.toResponseDto(team, await this.prefixLock.one(auth.tenantId, team));
  }

  @Post(':id/share')
  @Roles(Role.ADMIN, Role.PRODUCT)
  @ApiOperation({ summary: 'Toggle a team board public read-only link (admin/product)' })
  async share(
    @AuthUser() auth: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ShareTeamDto,
  ): Promise<TeamResponseDto> {
    const result = await this.setSharing.execute({
      tenantId: auth.tenantId,
      id,
      enabled: dto.enabled,
    });
    if (result.isFailure) throw new EntityNotFoundException(result.error as string);
    const team = result.getValue();
    return TeamMapper.toResponseDto(team, await this.prefixLock.one(auth.tenantId, team));
  }
}
