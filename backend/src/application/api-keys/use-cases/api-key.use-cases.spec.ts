import { UniqueEntityID } from '@core/domain';
import { Role } from '@core/interfaces';
import { GetApiKeysUseCase, RevokeApiKeyUseCase } from './api-key.use-cases';
import { ApiKeyEntity } from '../domain/api-key.entity';
import { IApiKeyRepository } from '../repositories/api-key.repository';

function makeKey(id: string, createdBy: string) {
  const result = ApiKeyEntity.create(
    { tenantId: 't1', name: `key-${id}`, keyHash: `hash-${id}`, prefix: 'phk_ab12', createdBy },
    new UniqueEntityID(id),
  );
  return result.getValue();
}

function makeRepo(keys: ApiKeyEntity[]): IApiKeyRepository {
  return {
    findById: async (id) => keys.find((k) => k.id.toString() === id) ?? null,
    findByHash: async () => null,
    findByTenant: async () => keys,
    save: async () => undefined,
    delete: async () => undefined,
  };
}

describe('GetApiKeysUseCase', () => {
  const keys = [makeKey('k1', 'admin-1'), makeKey('k2', 'dev-1'), makeKey('k3', 'dev-1')];

  it('returns every tenant key for an admin', async () => {
    const useCase = new GetApiKeysUseCase(makeRepo(keys));
    const result = await useCase.execute({ tenantId: 't1', userId: 'admin-1', role: Role.ADMIN });
    expect(result.getValue()).toHaveLength(3);
  });

  it('returns only the caller\'s own keys for a non-admin', async () => {
    const useCase = new GetApiKeysUseCase(makeRepo(keys));
    const result = await useCase.execute({ tenantId: 't1', userId: 'dev-1', role: Role.DEVELOPER });
    expect(result.getValue().map((k) => k.createdBy)).toEqual(['dev-1', 'dev-1']);
  });
});

describe('RevokeApiKeyUseCase', () => {
  it('lets a non-admin revoke their own key', async () => {
    const key = makeKey('k1', 'dev-1');
    const repo = makeRepo([key]);
    const useCase = new RevokeApiKeyUseCase(repo);
    const result = await useCase.execute({
      id: 'k1',
      tenantId: 't1',
      userId: 'dev-1',
      role: Role.DEVELOPER,
    });
    expect(result.isSuccess).toBe(true);
  });

  it("refuses a non-admin revoking someone else's key", async () => {
    const key = makeKey('k1', 'other-user');
    const repo = makeRepo([key]);
    const useCase = new RevokeApiKeyUseCase(repo);
    const result = await useCase.execute({
      id: 'k1',
      tenantId: 't1',
      userId: 'dev-1',
      role: Role.DEVELOPER,
    });
    expect(result.isFailure).toBe(true);
  });

  it("lets an admin revoke someone else's key", async () => {
    const key = makeKey('k1', 'other-user');
    const repo = makeRepo([key]);
    const useCase = new RevokeApiKeyUseCase(repo);
    const result = await useCase.execute({
      id: 'k1',
      tenantId: 't1',
      userId: 'admin-1',
      role: Role.ADMIN,
    });
    expect(result.isSuccess).toBe(true);
  });
});
