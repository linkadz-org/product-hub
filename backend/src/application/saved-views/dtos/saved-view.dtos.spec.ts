import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSavedViewDto } from './saved-view.dtos';
import { SAVED_VIEW_SCOPE_MAX } from '../domain/saved-view.types';

// Mirrors the app's real global pipe (see main.ts:
// `new ValidationPipe({ transform: true, whitelist: true })`) so this exercises
// the same transform/validate order the HTTP route hits.
async function runValidationPipe(body: Record<string, unknown>) {
  const instance = plainToInstance(CreateSavedViewDto, body, {
    enableImplicitConversion: false,
  });
  const errors = await validate(instance, { whitelist: true });
  return { instance, errors };
}

function create(scope?: unknown) {
  return { name: 'My triage', query: { kind: 'bug' }, ...(scope === undefined ? {} : { scope }) };
}

/**
 * `scope` names which board a saved view reopens on. A *shared* view is authored
 * by one user and opened by everyone in the workspace, so the column is
 * attacker-controlled input to a link — the frontend resolves it through a fixed
 * key→path table (`saved-views/scope.ts`), and this is the second, independent
 * guard: neither side relies on the other to be the only one.
 */
describe('CreateSavedViewDto.scope through the real ValidationPipe', () => {
  it.each(['issues', 'issues-me', 'team:6f1c2d3e4f5a6b7c8d9e0f1a', 'team:a_b-c'])(
    'accepts the board key %s',
    async (scope) => {
      const { instance, errors } = await runValidationPipe(create(scope));
      expect(errors).toHaveLength(0);
      expect(instance.scope).toBe(scope);
    },
  );

  it('leaves scope undefined when omitted — the entity defaults it to the workspace board, so every row written before scopes existed still reads correctly', async () => {
    const { instance, errors } = await runValidationPipe(create());
    expect(errors).toHaveLength(0);
    expect(instance.scope).toBeUndefined();
  });

  it.each([
    ['a protocol-relative href', '//evil.example'],
    ['an absolute URL', 'https://evil.example'],
    ['a path', '/issues'],
    ['a traversal', '../../admin'],
    ['a leading digit', '1team'],
    ['an upper-case key', 'Issues'],
    ['a second colon', 'team:a:b'],
    ['whitespace', 'team: 1'],
    ['an empty string', ''],
  ])('rejects %s', async (_label, scope) => {
    const { errors } = await runValidationPipe(create(scope));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('scope');
  });

  it('rejects a scope longer than the column allows, so an oversized key can never reach the database', async () => {
    const { errors } = await runValidationPipe(create(`team:${'a'.repeat(SAVED_VIEW_SCOPE_MAX)}`));
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('scope');
  });
});
