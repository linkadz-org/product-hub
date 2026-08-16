import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ActivityLogPresentationModule } from './activity-log.module';
import { GetActivityUseCase } from '@application/audit-log/use-cases/get-activity.use-case';

/**
 * There is no MongoDB in CI/dev for this task, so the only way to prove the DI
 * graph actually resolves — GetActivityUseCase gets both IAuditLogRepository
 * and IIssueRepository injected, and every module in between exports what the
 * next one needs — is to compile the real module graph here with the two
 * Mongoose models it pulls in stubbed out. A stub model is safe because the
 * repository constructors only store the injected model; they never call it
 * until a query method runs.
 */
describe('ActivityLogPresentationModule (DI graph)', () => {
  it('compiles without a live Mongo connection and resolves GetActivityUseCase', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ActivityLogPresentationModule],
    })
      .overrideProvider(getModelToken('AuditLog'))
      .useValue({})
      .overrideProvider(getModelToken('Issue'))
      .useValue({})
      .compile();

    const useCase = moduleRef.get(GetActivityUseCase);
    expect(useCase).toBeInstanceOf(GetActivityUseCase);
  });
});
