import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute, Role } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { generateApiKey, hashApiKey } from '@module-shared/utils/api-key.util';
import { CreateApiKeyDto } from '../dtos/api-key.dtos';
import { ApiKeyEntity } from '../domain/api-key.entity';
import { ApiKeyScope } from '../domain/api-key.enums';
import { IApiKeyRepository } from '../repositories/api-key.repository';

export interface GeneratedApiKey {
  entity: ApiKeyEntity;
  /** Plaintext — return to the caller once, never stored. */
  plaintext: string;
}

@Injectable()
export class GenerateApiKeyUseCase
  implements
    IUsecaseExecute<
      { tenantId: string; userId: string; dto: CreateApiKeyDto },
      Result<GeneratedApiKey>
    >
{
  constructor(@Inject(IApiKeyRepository) private readonly keys: IApiKeyRepository) {}
  async execute({
    tenantId,
    userId,
    dto,
  }: {
    tenantId: string;
    userId: string;
    dto: CreateApiKeyDto;
  }): Promise<Result<GeneratedApiKey>> {
    const { key, hash, prefix } = generateApiKey();
    const created = ApiKeyEntity.create({
      tenantId,
      name: dto.name,
      keyHash: hash,
      prefix,
      createdBy: userId,
      scope: dto.scope ?? ApiKeyScope.READ_ONLY,
    });
    if (created.isFailure) return Result.fail(created.error as string);
    const entity = created.getValue();
    await this.keys.save(entity);
    return Result.ok({ entity, plaintext: key });
  }
}

@Injectable()
export class GetApiKeysUseCase
  implements
    IUsecaseExecute<{ tenantId: string; userId: string; role: Role }, Result<ApiKeyEntity[]>>
{
  constructor(@Inject(IApiKeyRepository) private readonly keys: IApiKeyRepository) {}
  async execute({
    tenantId,
    userId,
    role,
  }: {
    tenantId: string;
    userId: string;
    role: Role;
  }): Promise<Result<ApiKeyEntity[]>> {
    const keys = await this.keys.findByTenant(tenantId);
    // Admin sees the whole tenant; everyone else sees only what they created —
    // a key list is a list of credentials, so no role should enumerate another's.
    return Result.ok(role === Role.ADMIN ? keys : keys.filter((k) => k.createdBy === userId));
  }
}

@Injectable()
export class RevokeApiKeyUseCase
  implements
    IUsecaseExecute<{ id: string; tenantId: string; userId: string; role: Role }, Result<void>>
{
  constructor(@Inject(IApiKeyRepository) private readonly keys: IApiKeyRepository) {}
  async execute({
    id,
    tenantId,
    userId,
    role,
  }: {
    id: string;
    tenantId: string;
    userId: string;
    role: Role;
  }): Promise<Result<void>> {
    const key = await this.keys.findById(id);
    if (!key || key.tenantId !== tenantId) return Result.fail('API key not found');
    // Same "not found" (not "forbidden") for someone else's key, so a non-admin
    // can't probe which ids exist outside their own.
    if (role !== Role.ADMIN && key.createdBy !== userId) return Result.fail('API key not found');
    await this.keys.delete(id);
    return Result.ok();
  }
}

@Injectable()
export class AuthenticateApiKeyUseCase
  implements IUsecaseExecute<{ key: string }, Result<ApiKeyEntity>>
{
  constructor(@Inject(IApiKeyRepository) private readonly keys: IApiKeyRepository) {}
  async execute({ key }: { key: string }): Promise<Result<ApiKeyEntity>> {
    if (!key) return Result.fail('Missing API key');
    const found = await this.keys.findByHash(hashApiKey(key));
    if (!found) return Result.fail('Invalid API key');
    found.markUsed();
    await this.keys.save(found);
    return Result.ok(found);
  }
}
