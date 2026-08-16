import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '@core/decorators';
import { JwtPayload } from '@core/interfaces';
import { EntityNotFoundException, ForbiddenDomainException, ValidationException } from '@core/exceptions';
import {
  CreateSavedViewUseCase,
  ListSavedViewsUseCase,
  UpdateSavedViewUseCase,
  DeleteSavedViewUseCase,
  ReorderSavedViewsUseCase,
} from '@application/saved-views/use-cases/saved-view.use-cases';
import {
  CreateSavedViewDto,
  UpdateSavedViewDto,
  ReorderSavedViewsDto,
} from '@application/saved-views/dtos/saved-view.dtos';
import { SavedViewResponseDto } from '@application/saved-views/dtos/saved-view.response.dto';
import { SavedViewMapper } from '@application/saved-views/mappers/saved-view.mapper';
import { SavedViewQuery } from '@application/saved-views/domain/saved-view.types';

const SAVED_VIEW_FORBIDDEN = 'Forbidden';
const SAVED_VIEW_NOT_FOUND = 'Saved view not found';

@ApiTags('Saved views')
@ApiBearerAuth('JWT-auth')
@Controller('saved-views')
export class SavedViewsController {
  constructor(
    private readonly createSavedView: CreateSavedViewUseCase,
    private readonly listSavedViews: ListSavedViewsUseCase,
    private readonly updateSavedView: UpdateSavedViewUseCase,
    private readonly deleteSavedView: DeleteSavedViewUseCase,
    private readonly reorderSavedViews: ReorderSavedViewsUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List saved views visible to me (mine + shared)' })
  async list(@AuthUser() auth: JwtPayload): Promise<SavedViewResponseDto[]> {
    const result = await this.listSavedViews.execute({
      tenantId: auth.tenantId,
      actor: { id: auth.userId, role: auth.role },
    });
    return SavedViewMapper.toDtoArray(result.getValue());
  }

  @Post()
  @ApiOperation({ summary: 'Create a saved view (owned by me)' })
  async create(
    @AuthUser() auth: JwtPayload,
    @Body() dto: CreateSavedViewDto,
  ): Promise<SavedViewResponseDto> {
    const result = await this.createSavedView.execute({
      tenantId: auth.tenantId,
      actor: { id: auth.userId, role: auth.role },
      dto: {
        name: dto.name,
        icon: dto.icon,
        shared: dto.shared,
        query: dto.query as unknown as SavedViewQuery,
      },
    });
    // Failures here are the 50-per-user cap or a domain validation (name too
    // long) — never an ownership question, so 400 is right for both.
    if (result.isFailure) throw new ValidationException(result.error as string);
    return SavedViewMapper.toDto(result.getValue());
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename / reshare / update the query of a saved view (owner or admin)' })
  async update(
    @AuthUser() auth: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSavedViewDto,
  ): Promise<SavedViewResponseDto> {
    const result = await this.updateSavedView.execute({
      tenantId: auth.tenantId,
      id,
      actor: { id: auth.userId, role: auth.role },
      dto: {
        name: dto.name,
        shared: dto.shared,
        query: dto.query as unknown as SavedViewQuery | undefined,
      },
    });
    if (result.isFailure) throw this.toHttpError(result.error as string);
    return SavedViewMapper.toDto(result.getValue());
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a saved view (owner or admin)' })
  async remove(@AuthUser() auth: JwtPayload, @Param('id') id: string): Promise<{ ok: true }> {
    const result = await this.deleteSavedView.execute({
      tenantId: auth.tenantId,
      id,
      actor: { id: auth.userId, role: auth.role },
    });
    if (result.isFailure) throw this.toHttpError(result.error as string);
    return { ok: true };
  }

  @Put('reorder')
  @ApiOperation({ summary: 'Reorder my own saved views (ids not mine are ignored)' })
  async reorder(
    @AuthUser() auth: JwtPayload,
    @Body() dto: ReorderSavedViewsDto,
  ): Promise<SavedViewResponseDto[]> {
    const result = await this.reorderSavedViews.execute({
      tenantId: auth.tenantId,
      actor: { id: auth.userId, role: auth.role },
      ids: dto.ids,
    });
    return SavedViewMapper.toDtoArray(result.getValue());
  }

  /** `Forbidden` → 403 (an ownership rule was violated by someone who can see
   *  the record); `Saved view not found` → 404 (no such id in this tenant, or
   *  it belongs to a different tenant — the repository is tenant-scoped so a
   *  cross-tenant id looks identical to a missing one, deliberately not
   *  distinguished from it to avoid confirming another tenant's ids exist).
   *  Anything else is a domain validation (e.g. renamed name too long) → 400. */
  private toHttpError(message: string): Error {
    if (message === SAVED_VIEW_FORBIDDEN) return new ForbiddenDomainException(message);
    if (message === SAVED_VIEW_NOT_FOUND) return new EntityNotFoundException(message);
    return new ValidationException(message);
  }
}
