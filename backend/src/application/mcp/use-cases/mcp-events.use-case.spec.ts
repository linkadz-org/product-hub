import { Role } from '@core/interfaces';
import { GetMcpEventsUseCase } from './mcp.use-cases';

/**
 * Pure unit test for the event-history scoping: admin reads the whole
 * tenant's log, everyone else is narrowed to their own userId — mirrors
 * GetApiKeysUseCase's scoping in ../../api-keys.
 */
describe('GetMcpEventsUseCase', () => {
  const query = { page: 1, limit: 10 } as never;
  const response = { data: [], total: 0, page: 1, limit: 10, totalPages: 1 };

  it('asks the repository for the whole tenant when the caller is admin', async () => {
    const findByTenant = jest.fn().mockResolvedValue(response);
    const useCase = new GetMcpEventsUseCase({ findByTenant } as never);

    await useCase.execute({ tenantId: 't1', userId: 'admin-1', role: Role.ADMIN, query });

    expect(findByTenant).toHaveBeenCalledWith('t1', query, undefined);
  });

  it('narrows the repository query to the caller for a non-admin', async () => {
    const findByTenant = jest.fn().mockResolvedValue(response);
    const useCase = new GetMcpEventsUseCase({ findByTenant } as never);

    await useCase.execute({ tenantId: 't1', userId: 'dev-1', role: Role.DEVELOPER, query });

    expect(findByTenant).toHaveBeenCalledWith('t1', query, 'dev-1');
  });
});
