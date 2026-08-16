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
import { DEFAULT_TASK_STATUSES, TaskStatus } from '@application/tasks/domain/enums/task.enums';
import { jwtConstants } from '@application/auth/constants';
import { GenerateApiKeyUseCase } from '@application/api-keys/use-cases/api-key.use-cases';
import { ApiKeyScope } from '@application/api-keys/domain/api-key.enums';
import { IAuditLogRepository } from '@application/audit-log/repositories/audit-log.repository';
import { AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { PaginationDto } from '@module-shared/modules/pagination/pagination.dto';

/**
 * End-to-end test of the activity timeline against a real MongoDB. Boots the
 * *real* Nest application, seeds tenants/users/teams/api-keys through the app's
 * own DI, then drives the HTTP endpoints exactly as a client would.
 *
 * Every one of Tasks 1–18 mocked `IAuditLogRepository`. This is the only test on
 * the branch where a use-case mutates an issue, the diff is computed, rows are
 * really written to Mongo, and the read path really queries them back with
 * permissions enforced. Nothing here is mocked.
 *
 * What it is specifically built to catch:
 *  - a snapshot taken *after* mutation (the diff would be permanently empty, so
 *    the status/assignees/description rows would simply not exist);
 *  - `buildEntityFilter` losing its `tenantId` clause (asserted straight against
 *    the real repository, not against a filter object);
 *  - `GetActivityUseCase` skipping `isVisibleTo` (a hidden issue's rows would
 *    come back with a 200 instead of a 404).
 */
describe('Activity (e2e)', () => {
  let app: INestApplication;
  let base: string;
  let auditRepo: IAuditLogRepository;

  const TENANT = 'e2e-activity-tenant';
  const OTHER_TENANT = 'e2e-activity-other-tenant';

  const ADMIN_NAME = 'E2E Activity Admin';
  const MEMBER_NAME = 'E2E Activity Member';
  const KEY_NAME = 'e2e-activity-key';

  let adminToken = '';
  let adminId = '';
  let memberToken = '';
  let memberId = '';
  let otherToken = '';
  let mcpKey = '';

  /** The lifecycle issue, shared by the first block of tests and deleted last. */
  let issueId = '';
  let issueRef = '';

  /** Distinct `createdAt` per action: the read sorts by it, so rows written in
   *  the same millisecond would come back in an arbitrary order. */
  const tick = () => new Promise((r) => setTimeout(r, 10));

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

  const asUser = (tok: string) => ({ authorization: `Bearer ${tok}` });

  const activity = (entityId: string, tok: string, entity = 'issue') =>
    call('GET', `/v1/activity?entity=${entity}&entityId=${encodeURIComponent(entityId)}`, undefined, asUser(tok));

  const mcp = (method: string, path: string, body?: unknown) =>
    call(method, path, body, { 'x-api-key': mcpKey });

  /** Seeds a tenant with an admin + default task team; returns the admin's JWT/id. */
  async function seedTenant(
    tenantId: string,
    email: string,
    name: string,
  ): Promise<{ token: string; userId: string }> {
    const teams = app.get<ITeamRepository>(ITeamRepository);
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
    return seedUser(tenantId, email, name, Role.ADMIN);
  }

  /** Seeds one user and hand-signs the JWT `LoginUseCase` would have issued.
   *
   *  NOT `app.get(JwtService)`: the app registers *two* independent JwtModules
   *  (tenant auth, and a separately-secreted one for the platform console). Both
   *  bind the same `JwtService` class token and Nest resolves the ambiguity by
   *  module compile order, handing back the platform's instance — whose
   *  signature the tenant JwtStrategy rejects. See the same note in
   *  `search.e2e-spec.ts`. */
  async function seedUser(
    tenantId: string,
    email: string,
    name: string,
    role: Role,
  ): Promise<{ token: string; userId: string }> {
    const users = app.get<IUserRepository>(IUserRepository);
    const jwt = new JwtService({
      secret: jwtConstants.secret,
      signOptions: { expiresIn: jwtConstants.expiresIn as JwtSignOptions['expiresIn'] },
    });
    const user = UserEntity.create({
      tenantId,
      email,
      name,
      passwordHash: 'x',
      role,
    }).getValue();
    await users.save(user);
    const userId = user.id.toString();
    // Payload shape copied from LoginUseCase (`userId`, not `sub`).
    return {
      token: jwt.sign({ userId, tenantId, email: user.email, name: user.name, role: user.role }),
      userId,
    };
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

    auditRepo = app.get<IAuditLogRepository>(IAuditLogRepository);

    const admin = await seedTenant(TENANT, 'admin@e2e-activity.test', ADMIN_NAME);
    adminToken = admin.token;
    adminId = admin.userId;

    // A second, NON-admin member of the same tenant: `isVisibleTo` waves admins
    // through, so a personal task is only genuinely hidden from a non-admin.
    const member = await seedUser(
      TENANT,
      'member@e2e-activity.test',
      MEMBER_NAME,
      Role.DEVELOPER,
    );
    memberToken = member.token;
    memberId = member.userId;

    otherToken = (await seedTenant(OTHER_TENANT, 'admin@e2e-activity-other.test', 'Other Admin'))
      .token;

    const genKey = app.get(GenerateApiKeyUseCase);
    mcpKey = (
      await genKey.execute({
        tenantId: TENANT,
        userId: adminId,
        dto: { name: KEY_NAME, scope: ApiKeyScope.READ_WRITE },
      })
    ).getValue().plaintext;
  }, 60000);

  afterAll(async () => {
    await app?.close();
  });

  // ── One full lifecycle ─────────────────────────────────────────────────────
  // Create → status → assignees → description, each its own HTTP request, then
  // read the whole timeline back.

  it('records a `created` row when an issue is created', async () => {
    const created = await call(
      'POST',
      '/v1/issues',
      { kind: 'task', title: 'Activity lifecycle' },
      asUser(adminToken),
    );
    expect(created.status).toBeLessThan(300);
    issueId = created.body.id;
    issueRef = created.body.shortId;
    expect(issueId).toBeTruthy();

    const res = await activity(issueId, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      entity: 'issue',
      entityId: issueId,
      entityRef: issueRef,
      field: 'created',
      oldValue: '',
      newValue: '',
      actorType: 'user',
      actorId: adminId,
      actorName: ADMIN_NAME,
      automated: false,
      relationLabel: '',
    });
    await tick();
  });

  it('records a `status` row carrying both the old and the new column', async () => {
    const moved = await call(
      'PATCH',
      `/v1/issues/${issueId}/status`,
      { status: TaskStatus.IN_PROGRESS },
      asUser(adminToken),
    );
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe(TaskStatus.IN_PROGRESS);

    const res = await activity(issueId, adminToken);
    const row = res.body.items.find((r: any) => r.field === 'status');
    // Both values, not just the destination: `todo` is the column the issue was
    // born in, and it is only knowable if it was read *before* `setStatus` ran.
    expect(row).toMatchObject({
      field: 'status',
      oldValue: TaskStatus.TODO,
      newValue: TaskStatus.IN_PROGRESS,
      actorType: 'user',
      actorName: ADMIN_NAME,
    });
    await tick();
  });

  it('records an `assignees` row rendered as names, not ids', async () => {
    const patched = await call(
      'PATCH',
      `/v1/issues/${issueId}`,
      { assigneeIds: [memberId] },
      asUser(adminToken),
    );
    expect(patched.status).toBe(200);

    const res = await activity(issueId, adminToken);
    const row = res.body.items.find((r: any) => r.field === 'assignees');
    expect(row).toBeDefined();
    // The rendered *name*, and no id anywhere in the row — a raw user id here
    // would mean `issue-diff.read()` stopped resolving `assignees`.
    expect(row.oldValue).toBe('');
    expect(row.newValue).toBe(MEMBER_NAME);
    expect(row.newValue).not.toContain(memberId);
    await tick();
  });

  it('records a `description` row with empty old and new values', async () => {
    const body = 'A long-form description that must never be copied into the log.';
    const patched = await call(
      'PATCH',
      `/v1/issues/${issueId}`,
      { description: body },
      asUser(adminToken),
    );
    expect(patched.status).toBe(200);
    // The description really did change — so the empty values below are the
    // deliberate NO_VALUE_FIELDS redaction, not a diff that saw no change.
    expect(patched.body.description).toBe(body);

    const res = await activity(issueId, adminToken);
    const row = res.body.items.find((r: any) => r.field === 'description');
    expect(row).toBeDefined();
    expect(row.oldValue).toBe('');
    expect(row.newValue).toBe('');
    // And the text itself is nowhere in the stored history.
    expect(JSON.stringify(res.body.items)).not.toContain(body);
    await tick();
  });

  it('returns exactly those four rows, newest first', async () => {
    const res = await activity(issueId, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    // Newest first (`createdAt: -1`), so the lifecycle reads bottom-up.
    expect(res.body.items.map((r: any) => r.field)).toEqual([
      'description',
      'assignees',
      'status',
      'created',
    ]);
    const times = res.body.items.map((r: any) => new Date(r.createdAt).getTime());
    expect(times).toEqual([...times].sort((a: number, b: number) => b - a));
    // Every row is this issue's own — nothing related was linked, so no row
    // carries a relation label.
    for (const row of res.body.items) {
      expect(row.entityId).toBe(issueId);
      expect(row.relationLabel).toBe('');
      expect(row.automated).toBe(false);
    }
    expect(res.body.relatedTruncated).toBe(false);
  });

  // ── Tenant isolation ───────────────────────────────────────────────────────

  it("does not expose another tenant's issue through the endpoint", async () => {
    const created = await call(
      'POST',
      '/v1/issues',
      { kind: 'task', title: 'Other tenant issue' },
      asUser(otherToken),
    );
    expect(created.status).toBeLessThan(300);
    const otherIssueId = created.body.id;

    expect((await activity(otherIssueId, adminToken)).status).toBe(404);
    // Sanity: the owning tenant *does* see it — proves the 404 is isolation,
    // not a timeline that was never written.
    const owned = await activity(otherIssueId, otherToken);
    expect(owned.status).toBe(200);
    expect(owned.body.items.map((r: any) => r.field)).toEqual(['created']);

    // And the isolation holds one layer down, on a real Mongo query rather than
    // on an asserted filter object: the same entity ref, read under the wrong
    // tenant, matches nothing.
    const ref = [{ entity: AuditEntity.ISSUE, entityId: otherIssueId }];
    const page = Object.assign(new PaginationDto(), { page: 1, limit: 50 });
    expect((await auditRepo.findByEntities(TENANT, ref, page)).total).toBe(0);
    expect((await auditRepo.findByEntities(OTHER_TENANT, ref, page)).total).toBe(1);
  });

  // ── Visibility ─────────────────────────────────────────────────────────────

  it('gives a user who cannot see the issue a 404, not an empty list', async () => {
    const created = await call(
      'POST',
      '/v1/issues',
      { kind: 'task', title: 'Private plan', personal: true },
      asUser(adminToken),
    );
    expect(created.status).toBeLessThan(300);
    const personalId = created.body.id;

    // The owner sees the row…
    const owner = await activity(personalId, adminToken);
    expect(owner.status).toBe(200);
    expect(owner.body.items).toHaveLength(1);

    // …and a non-admin who is not the owner is refused outright. A 200 with
    // `items: []` would mean the guard was skipped and the read merely happened
    // to match nothing — the endpoint must not confirm the issue exists at all.
    const outsider = await activity(personalId, memberToken);
    expect(outsider.status).toBe(404);
    expect(outsider.body?.items).toBeUndefined();
  });

  it('refuses an entity kind it cannot authorise', async () => {
    // `report` is a valid AuditEntity but GetActivityUseCase has no guard for
    // it, so it is refused *before* the repository is touched.
    expect((await activity(issueId, adminToken, 'report')).status).toBe(404);
    // …and one that is not an AuditEntity at all is rejected by the DTO.
    expect((await activity(issueId, adminToken, 'not-a-kind')).status).toBe(400);
  });

  // ── MCP writes ─────────────────────────────────────────────────────────────

  it("attributes an MCP write to 'api' and the key's name", async () => {
    const created = await mcp('POST', '/v1/mcp/issues', {
      kind: 'task',
      title: 'MCP written',
    });
    expect([200, 201]).toContain(created.status);
    const mcpIssueId = created.body.id;

    await tick();
    const edited = await mcp('PATCH', `/v1/mcp/issues/${created.body.shortId}`, {
      title: 'MCP written (edited)',
    });
    expect(edited.status).toBe(200);

    const res = await activity(mcpIssueId, adminToken);
    expect(res.status).toBe(200);

    const titleRow = res.body.items.find((r: any) => r.field === 'title');
    expect(titleRow).toMatchObject({
      actorType: 'api',
      // The key's name, so a bot edit is never mistaken for the key owner
      // typing it themselves (`update_issue` passes `requesterName: keyName`).
      actorName: KEY_NAME,
      oldValue: 'MCP written',
      newValue: 'MCP written (edited)',
    });
    // The write is attributed to the key's *owner* as the actor id — the row
    // says a robot did it on that person's behalf, not that the key is a user.
    expect(titleRow.actorId).toBe(adminId);

    // The `created` row is also `api`, but carries the key owner's display name
    // rather than the key's: `create_issue` passes
    // `createdByName: actorUser?.name ?? actor.keyName` (mcp.use-cases.ts:325)
    // where `update_issue` passes `actor.keyName` outright (:602). Asserted as
    // it actually behaves; see the report for the inconsistency.
    const createdRow = res.body.items.find((r: any) => r.field === 'created');
    expect(createdRow.actorType).toBe('api');
    expect(createdRow.actorName).toBe(ADMIN_NAME);
  });

  // ── Deletion ───────────────────────────────────────────────────────────────
  // Runs last: it destroys the lifecycle issue.

  it('keeps a deleted issue\'s rows in the store, and appends a `deleted` row', async () => {
    const removed = await call('DELETE', `/v1/issues/${issueId}`, undefined, asUser(adminToken));
    expect(removed.status).toBe(200);
    expect((await call('GET', `/v1/issues/${issueId}`, undefined, asUser(adminToken))).status).toBe(
      404,
    );

    // The log is append-only and outlives the object it describes: all four
    // lifecycle rows are still there, plus the `deleted` row, still carrying the
    // ref the issue had when it existed.
    const page = Object.assign(new PaginationDto(), { page: 1, limit: 50 });
    const stored = await auditRepo.findByEntities(
      TENANT,
      [{ entity: AuditEntity.ISSUE, entityId: issueId }],
      page,
    );
    expect(stored.total).toBe(5);
    expect(stored.data.map((r) => r.field).sort()).toEqual([
      'assignees',
      'created',
      'deleted',
      'description',
      'status',
    ]);
    expect(stored.data.every((r) => r.entityRef === issueRef)).toBe(true);
  });

  it('serves a deleted issue\'s timeline as 404 — the guard needs the object', async () => {
    // DEVIATION FROM THE BRIEF, asserted as the code actually behaves.
    //
    // The brief expected `entityId` of a deleted issue to still return its rows.
    // It cannot: `IssueRepository.delete` is a hard delete, and
    // `GetActivityUseCase` reads the issue first so it can run `isVisibleTo`
    // against it. With no issue there is no permission to check, and the
    // use-case returns its uniform 'Not found' rather than serving history
    // unguarded. The rows themselves are intact (previous test) — only the
    // authenticated read path cannot reach them.
    const res = await activity(issueId, adminToken);
    expect(res.status).toBe(404);
  });
});
