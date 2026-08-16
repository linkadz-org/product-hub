import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  CreateSavedViewUseCase,
  ListSavedViewsUseCase,
  UpdateSavedViewUseCase,
  DeleteSavedViewUseCase,
  ReorderSavedViewsUseCase,
} from '@application/saved-views/use-cases/saved-view.use-cases';
import { ISavedViewRepository } from '@application/saved-views/repositories/saved-view.repository';
import { SavedViewsPresentationModule } from './saved-views.module';

/**
 * There is no MongoDB in CI/dev for this task, so the only way to prove the DI
 * graph actually resolves — the `SavedView` model token matches what the
 * infra module registers, the repository binds to `ISavedViewRepository`, and
 * every use-case gets constructed — is to compile the real module graph here
 * with the Mongoose model stubbed out. A stub model is safe because the
 * repository constructor only stores the injected model; it never calls it
 * until a use-case runs.
 */
describe('SavedViewsPresentationModule (DI graph)', () => {
  it('compiles without a live Mongo connection and resolves the saved-views use-cases', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SavedViewsPresentationModule],
    })
      .overrideProvider(getModelToken('SavedView'))
      .useValue({})
      .compile();

    expect(moduleRef.get(CreateSavedViewUseCase)).toBeInstanceOf(CreateSavedViewUseCase);
    expect(moduleRef.get(ListSavedViewsUseCase)).toBeInstanceOf(ListSavedViewsUseCase);
    expect(moduleRef.get(UpdateSavedViewUseCase)).toBeInstanceOf(UpdateSavedViewUseCase);
    expect(moduleRef.get(DeleteSavedViewUseCase)).toBeInstanceOf(DeleteSavedViewUseCase);
    expect(moduleRef.get(ReorderSavedViewsUseCase)).toBeInstanceOf(ReorderSavedViewsUseCase);

    const repo = moduleRef.get<ISavedViewRepository>(ISavedViewRepository as never);
    expect(repo).toBeDefined();
  });
});
