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
import { ITeamRepository } from '@application/teams/repositories/team.repository';
import { UserEntity } from '@application/users/domain/entities/user.entity';
import { TeamEntity } from '@application/teams/domain/entities/team.entity';
import { DEFAULT_TEAMS, TeamIssueType } from '@application/teams/domain/enums/team.enums';
import { DEFAULT_TASK_STATUSES } from '@application/tasks/domain/enums/task.enums';
import { jwtConstants } from '@application/auth/constants';

/**
 * End-to-end test of `GET /v1/search` against a real MongoDB. Boots the *real*
 * Nest application, seeds a tenant/user/team through the app's own DI, then
 * drives the HTTP endpoint with a hand-signed JWT (the seeded user's
 * `passwordHash` isn't a real hash, so login via HTTP isn't possible here).
 *
 * The point of this file is the seam no unit test could cross: that an issue
 * written through the real repository's `toDocument()` is actually found by a
 * query built in the search repository, including through Vietnamese
 * diacritics, and that tenant isolation holds on a real Mongo query — not just
 * in an asserted filter object.
 */
describe('Search (e2e)', () => {
  let app: INestApplication;
  let base: string;
  let token: string;
  let otherTenantToken: string;

  const TENANT = 'e2e-search-tenant';
  const OTHER_TENANT = 'e2e-search-other-tenant';

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

  const search = (q: string, tok = token) =>
    call('GET', `/v1/search?q=${encodeURIComponent(q)}`, undefined, {
      authorization: `Bearer ${tok}`,
    });

  const createIssue = (title: string, tok = token) =>
    call('POST', '/v1/issues', { kind: 'task', title }, { authorization: `Bearer ${tok}` });

  const createDoc = (title: string, tok = token) =>
    call('POST', '/v1/docs', { title }, { authorization: `Bearer ${tok}` });

  /** Seeds one tenant with an admin user + default task team, returns a signed JWT. */
  async function seedTenant(tenantId: string, email: string): Promise<string> {
    const users = app.get<IUserRepository>(IUserRepository);
    const teams = app.get<ITeamRepository>(ITeamRepository);
    // NOT `app.get(JwtService)`: the app registers *two* independent JwtModules
    // (tenant auth here, and a separately-secreted one for the platform console
    // in src/application/platform/platform.module.ts). Both bind the same
    // `JwtService` class token, and Nest's container resolves the ambiguity by
    // module compile order rather than by which module you asked — in this app
    // that silently hands back the *platform's* JwtService, signed with
    // `${JWT_SECRET}::platform`, which the tenant JwtStrategy then rejects as an
    // invalid signature (measured directly: `app.select(ApplicationAuthModule)
    // .get(JwtService)` still returned the platform instance). Constructing a
    // JwtService by hand from the exact constants LoginUseCase signs with
    // sidesteps the ambiguity entirely.
    const jwt = new JwtService({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: jwtConstants.expiresIn as JwtSignOptions['expiresIn'] },
    });

    const owner = UserEntity.create({
      tenantId,
      email,
      name: 'E2E Search Admin',
      passwordHash: 'x',
      role: Role.ADMIN,
    }).getValue();
    await users.save(owner);

    const engineering = DEFAULT_TEAMS.find((t) => t.issueType === TeamIssueType.TASK)!;
    const team = TeamEntity.create({
      tenantId,
      key: engineering.key,
      name: engineering.name,
      issueType: TeamIssueType.TASK,
      refPrefix: engineering.refPrefix,
      statuses: DEFAULT_TASK_STATUSES,
    }).getValue();
    await teams.save(team);

    // Payload shape copied from LoginUseCase (`userId`, not `sub` — the brief's
    // sketch used `sub`, but JwtStrategy.validate reads `payload.userId`).
    return jwt.sign({
      userId: owner.id.toString(),
      tenantId,
      email: owner.email,
      name: owner.name,
      role: owner.role,
    });
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

    token = await seedTenant(TENANT, 'admin@e2e-search.test');
    otherTenantToken = await seedTenant(OTHER_TENANT, 'admin@e2e-search-other.test');
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  it('từ chối khi không có token', async () => {
    expect((await call('GET', '/v1/search?q=abc')).status).toBe(401);
  });

  // The brief sketched this as "q shorter than 2 chars returns 200 with empty
  // groups" — that was GlobalSearchUseCase's own early-return. Measured against
  // the real HTTP boundary it's stale: SearchQueryDto now enforces
  // `@MinLength(2)` (added after that use-case shortcut was written, per the
  // DTO's own comment: "reject it here instead so the caller gets a 400, not
  // an empty 200"). ValidationPipe rejects 'a' before the use-case ever runs.
  it('từ chối q dưới 2 ký tự bằng 400 (DTO boundary, không phải use-case early-return)', async () => {
    const res = await search('a');
    expect(res.status).toBe(400);
  });

  it('tìm được issue tiếng Việt khi gõ KHÔNG dấu', async () => {
    await createIssue('Đăng nhập bằng OTP');
    const res = await search('dang nhap');
    expect(res.status).toBe(200);
    const issues = res.body.groups.find((g: { type: string }) => g.type === 'issue');
    expect(issues.items.map((i: { title: string }) => i.title)).toContain('Đăng nhập bằng OTP');
  });

  it('tìm được issue bằng mã ref vừa được cấp', async () => {
    const created = await createIssue('Tim bang ref');
    expect(created.status).toBeLessThan(300);
    const res = await search(created.body.shortId);
    const issues = res.body.groups.find((g: { type: string }) => g.type === 'issue');
    expect(issues.items[0].ref).toBe(created.body.shortId);
  });

  // ── Coverage gap from Task 4: only doc-page had a genuine repository-level
  // proof of its search-field computation. This closes it for `doc` too — a
  // real toDocument() write, found through a real DocSearchRepository query,
  // diacritics included.
  it('tìm được doc tiếng Việt khi gõ KHÔNG dấu (doc repository toDocument round trip)', async () => {
    await createDoc('Hướng dẫn triển khai sản phẩm');
    const res = await search('huong dan trien khai');
    expect(res.status).toBe(200);
    const docs = res.body.groups.find((g: { type: string }) => g.type === 'doc');
    expect(docs?.items.map((i: { title: string }) => i.title)).toContain(
      'Hướng dẫn triển khai sản phẩm',
    );
  });

  // ── Tenant isolation on a real Mongo query. Unit tests only asserted the
  // filter object built by a repository contained tenantId; this proves Mongo
  // actually honours it — a same-titled issue in another tenant must not leak.
  it('không thấy issue của tenant khác dù cùng nội dung tìm kiếm', async () => {
    await createIssue('Chi tiet rieng tu cua tenant khac', otherTenantToken);
    const res = await search('chi tiet rieng tu');
    const issues = res.body.groups.find((g: { type: string }) => g.type === 'issue');
    expect(issues?.items ?? []).toEqual([]);

    // Sanity: the other tenant's own token *does* find it — proves the miss
    // above is isolation, not a broken query.
    const otherRes = await search('chi tiet rieng tu', otherTenantToken);
    const otherIssues = otherRes.body.groups.find((g: { type: string }) => g.type === 'issue');
    expect(otherIssues.items.map((i: { title: string }) => i.title)).toContain(
      'Chi tiet rieng tu cua tenant khac',
    );
  });

  it('từ chối limit ngoài khoảng 1-20 bằng 400', async () => {
    const tooHigh = await call('GET', '/v1/search?q=dang%20nhap&limit=21', undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(tooHigh.status).toBe(400);

    const tooLow = await call('GET', '/v1/search?q=dang%20nhap&limit=0', undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(tooLow.status).toBe(400);
  });
});
