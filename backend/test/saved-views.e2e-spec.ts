// Point the app at the throwaway e2e database BEFORE AppModule's ConfigModule
// reads it. process.env wins over any .env file, so this is authoritative.
process.env.MONGODB_URI = 'mongodb://localhost:27017/producthub_e2e';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'e2e-test-secret';

import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import type { Connection } from 'mongoose';
import type { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { Role } from '@core/interfaces';
import { IUserRepository } from '@application/users/repositories/user.repository';
import { UserEntity } from '@application/users/domain/entities/user.entity';
import { jwtConstants } from '@application/auth/constants';

/**
 * End-to-end test of `/v1/saved-views` against a real MongoDB. Boots the *real*
 * Nest application, seeds two users on the same tenant, and drives the HTTP
 * endpoints with hand-signed JWTs (the seeded users' `passwordHash` isn't a
 * real hash, so login via HTTP isn't possible here).
 *
 * The permission matrix (`canMutateSavedView`) was already proven unit-tested
 * against a fake repository. What that couldn't cross is whether the ownership
 * check actually holds once `findById` is a real tenant-scoped Mongo query and
 * the controller's `toHttpError` mapping is wired end to end (Forbidden → 403).
 *
 * `owner` is seeded as TESTER, not ADMIN: `canMutateSavedView` lets an ADMIN
 * mutate *any* view regardless of ownership, so if the owner were ADMIN the
 * "stranger can view but not edit a shared view" test wouldn't actually be
 * exercising the ownership gate — it would coincidentally pass either way.
 */
describe('Saved views (e2e)', () => {
  let app: INestApplication;
  let base: string;
  let ownerToken: string;
  let strangerToken: string;

  const TENANT = 'e2e-saved-views-tenant';

  /** One HTTP call. Returns status + parsed body (json or text), `.data` unwrapped. */
  async function call(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* keep raw text */
    }
    // Success responses are wrapped by TransformInterceptor as `{ statusCode, data }`;
    // errors come straight from the exception filter as `{ statusCode, message }`.
    const payload =
      parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
    return { status: res.status, body: payload };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Mirror main.ts's global setup that lives outside the module.
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: 'v1', prefix: '' });
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;

    // Clean slate: the mongo volume persists between runs, so drop the throwaway
    // db before seeding or the second run trips the unique-email index.
    const conn = app.get<Connection>(getConnectionToken());
    await conn.dropDatabase();

    const users = app.get<IUserRepository>(IUserRepository);
    // NOT `app.get(JwtService)`: the app registers two independently-secreted
    // JwtModules (this tenant one, and a separate one for the platform console
    // — see src/application/platform/platform.module.ts). Both bind the same
    // `JwtService` class token, and `app.get`/`app.select(...).get` resolves
    // the ambiguity by module compile order rather than by which module you
    // asked; in this app it silently hands back the platform's JwtService
    // (measured directly — signed tokens failed signature verification against
    // the tenant secret). Constructing a JwtService from the exact constants
    // LoginUseCase signs with sidesteps the ambiguity entirely.
    const jwt = new JwtService({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: jwtConstants.expiresIn as JwtSignOptions['expiresIn'] },
    });

    const owner = UserEntity.create({
      tenantId: TENANT,
      email: 'owner@e2e-saved-views.test',
      name: 'E2E Owner',
      passwordHash: 'x',
      role: Role.TESTER,
    }).getValue();
    await users.save(owner);

    const stranger = UserEntity.create({
      tenantId: TENANT,
      email: 'stranger@e2e-saved-views.test',
      name: 'E2E Stranger',
      passwordHash: 'x',
      role: Role.TESTER,
    }).getValue();
    await users.save(stranger);

    // Payload shape copied from LoginUseCase (`userId`, not `sub` — the brief's
    // sketch used `sub`, but JwtStrategy.validate reads `payload.userId`).
    const sign = (u: typeof owner) =>
      jwt.sign({ userId: u.id.toString(), tenantId: TENANT, email: u.email, name: u.name, role: u.role });
    ownerToken = sign(owner);
    strangerToken = sign(stranger);
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('người khác KHÔNG thấy view riêng tư', async () => {
    await call(
      'POST',
      '/v1/saved-views',
      {
        name: 'Rieng tu',
        query: { kind: 'task', view: 'board', filters: {}, sort: null, search: '' },
      },
      { authorization: `Bearer ${ownerToken}` },
    );

    const list = await call('GET', '/v1/saved-views', undefined, {
      authorization: `Bearer ${strangerToken}`,
    });
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);
  });

  it('view shared thì người khác THẤY', async () => {
    const created = await call(
      'POST',
      '/v1/saved-views',
      {
        name: 'Chia se',
        shared: true,
        query: { kind: 'bug', view: 'list', filters: { severity: ['critical'] }, sort: null, search: '' },
      },
      { authorization: `Bearer ${ownerToken}` },
    );
    expect(created.status).toBeLessThan(300);

    const list = await call('GET', '/v1/saved-views', undefined, {
      authorization: `Bearer ${strangerToken}`,
    });
    expect(list.body.map((v: { id: string }) => v.id)).toContain(created.body.id);
  });

  it('nhưng người khác KHÔNG sửa được view shared', async () => {
    const created = await call(
      'POST',
      '/v1/saved-views',
      {
        name: 'Chia se 2',
        shared: true,
        query: { kind: 'task', view: 'board', filters: {}, sort: null, search: '' },
      },
      { authorization: `Bearer ${ownerToken}` },
    );
    expect(created.status).toBeLessThan(300);

    const res = await call(
      'PATCH',
      `/v1/saved-views/${created.body.id}`,
      { name: 'Cuop' },
      { authorization: `Bearer ${strangerToken}` },
    );
    expect(res.status).toBe(403);

    // The view is untouched — the 403 wasn't a coincidence of a validation error.
    const list = await call('GET', '/v1/saved-views', undefined, {
      authorization: `Bearer ${ownerToken}`,
    });
    const untouched = list.body.find((v: { id: string }) => v.id === created.body.id);
    expect(untouched.name).toBe('Chia se 2');
  });

  it('owner sửa được view của chính mình', async () => {
    const created = await call(
      'POST',
      '/v1/saved-views',
      {
        name: 'Cua toi',
        query: { kind: 'task', view: 'board', filters: {}, sort: null, search: '' },
      },
      { authorization: `Bearer ${ownerToken}` },
    );
    expect(created.status).toBeLessThan(300);

    const res = await call(
      'PATCH',
      `/v1/saved-views/${created.body.id}`,
      { name: 'Da doi ten' },
      { authorization: `Bearer ${ownerToken}` },
    );
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Da doi ten');
  });
});
