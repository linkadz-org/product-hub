import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { GlobalSearchUseCase } from '@application/search/use-cases';
import { ISearchableRepository } from '@application/search/repositories/searchable.repository';
import { SearchPresentationModule } from './search.module';

/**
 * There is no MongoDB in CI/dev for this task, so the only way to prove the DI
 * graph actually resolves — token names match, all seven repositories land in
 * the `ISearchableRepository` array, nothing is missing a provider — is to
 * compile the real module graph here with the six Mongoose models stubbed out.
 * A stub model is safe because the repository constructors only store the
 * injected model; they never call it until `.search()` runs.
 */
describe('SearchPresentationModule (DI graph)', () => {
  it('compiles without a live Mongo connection and resolves all seven searchable repositories', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SearchPresentationModule],
    })
      .overrideProvider(getModelToken('Issue'))
      .useValue({})
      .overrideProvider(getModelToken('Doc'))
      .useValue({})
      .overrideProvider(getModelToken('DocPage'))
      .useValue({})
      .overrideProvider(getModelToken('Project'))
      .useValue({})
      .overrideProvider(getModelToken('Report'))
      .useValue({})
      .overrideProvider(getModelToken('Roadmap'))
      .useValue({})
      .compile();

    const useCase = moduleRef.get(GlobalSearchUseCase);
    expect(useCase).toBeInstanceOf(GlobalSearchUseCase);

    const repos = moduleRef.get<ISearchableRepository[]>(ISearchableRepository as never);
    expect(repos).toHaveLength(7);
  });
});
