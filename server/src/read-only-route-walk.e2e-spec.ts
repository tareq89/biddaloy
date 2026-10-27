import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  INestApplication,
  NestInterceptor,
  ValidationPipe,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { buildFullPath, RequestMethodName } from '@test/helpers/route-path.helper';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { SEED_SECTION_1_ID } from '@test/constants';
import { ContextGuard } from './modules/auth/guards/context.guard';
import { TenantStatusService } from './modules/schools/tenant-status.service';
import { ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY } from './modules/auth/decorators/allow-when-suspended-for-billing.decorator';
import { ALLOW_WHEN_READ_ONLY_KEY } from './modules/auth/decorators/allow-when-read-only.decorator';

const WALK_EMAIL = 'read-only-walk@biddaloy.test';
const WALK_USER_ID = '00000000-0000-4000-8000-0000000e7549';
const SENTINEL = 299;
const BATCH = 20;
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
/** A user's own writes, marked @AllowWhenReadOnly: they must PASS while the school is read-only. */
const USER_LEVEL_WRITES = [
  'DELETE /api/v1/me/push/subscriptions',
  'DELETE /api/v1/me/push/subscriptions/:id',
  'PATCH /api/v1/users/me/preferences/dashboard',
  'PATCH /api/v1/users/me/preferences/digest',
  'PATCH /api/v1/users/me/preferences/notifications',
  'POST /api/v1/attention/items/:recipientId/hide',
  'POST /api/v1/attention/items/:recipientId/snooze',
  'POST /api/v1/attention/items/seen',
  'POST /api/v1/auth/step-up',
  'POST /api/v1/auth/step-up/otp/request',
  'POST /api/v1/me/push/subscriptions',
];

/** Guards-only interceptor, as in `route-status-snapshot.e2e-spec.ts`: no handler ever runs. */
let guardsOnly = false;
class GuardsPassedInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    if (!guardsOnly) return next.handle();
    throw new HttpException('read-only-walk: guards passed', SENTINEL);
  }
}

/**
 * Epic 49 D9 money-tier walk: with the seed school over its seats (seat_limit 0, one ACTIVE
 * student), EVERY write route any school role can normally reach must answer 403 TENANT_READ_ONLY,
 * except handlers marked `@AllowWhenSuspendedForBilling` (the pay-to-reopen routes), which must
 * not. "Normally reach" comes from the school-role columns of `route-status.snapshot.txt`, so the walk
 * and the Rule 20 snapshot cannot drift apart. ContextGuard runs before PermissionsGuard, so the
 * answer is the same whatever the role, so the one ADMIN token is enough.
 *
 * Limits: routes that do not run ContextGuard are not walked (see "Over the seats" in
 * docs/architecture/34-onboarding.md for the intended exemptions), and routes only a platform
 * token reaches are exempt by design. No other token is faked here.
 */
describe('Read-only route walk (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let previousSeatLimit: number | null;
  let insertedStudentId: string | null = null;

  const send = async (method: string, path: string) => {
    try {
      const res = await supertest(server)
        [method.toLowerCase() as 'post'](path)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', UserRole.ADMIN)
        .timeout({ response: 15000, deadline: 20000 });
      return {
        status: res.status,
        code: res.status === SENTINEL ? 'PASS' : (res.body?.details?.code as string | undefined),
      };
    } catch (e) {
      return { status: 0, code: `ERR(${(e as Error).message.slice(0, 30)})` };
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.useGlobalInterceptors(new GuardsPassedInterceptor());
    await app.listen(0);
    server = app.getHttpServer();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Read Only Walk', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [WALK_USER_ID, WALK_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [WALK_USER_ID, SEED_TENANT_ID],
    );
    token = (
      await supertest(server)
        .post('/api/v1/auth/login')
        .send({ email: WALK_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;

    guardsOnly = true;
  }, 60000);

  afterAll(async () => {
    guardsOnly = false;
    if (dataSource) {
      await dataSource.query('UPDATE schools SET seat_limit = $2 WHERE id = $1', [
        SEED_TENANT_ID,
        previousSeatLimit ?? null,
      ]);
      if (insertedStudentId) {
        await dataSource.query('DELETE FROM students WHERE id = $1', [insertedStudentId]);
      }
      await dataSource.query('DELETE FROM refresh_tokens WHERE user_id = $1', [WALK_USER_ID]);
      await dataSource.query('DELETE FROM user_tenants WHERE user_id = $1', [WALK_USER_ID]);
      await dataSource.query('DELETE FROM users WHERE id = $1', [WALK_USER_ID]);
      await app.get(TenantStatusService).invalidate(SEED_TENANT_ID);
    }
    await app?.close();
  });

  it('every write an ADMIN can normally reach is 403 TENANT_READ_ONLY; billing-allowed handlers are not', async () => {
    // Set up inside the test: the shared per-test reset (test/setup.ts beforeEach) wipes students.
    // Force "over": limit 0 and one ACTIVE student.
    previousSeatLimit = (
      await dataSource.query('SELECT seat_limit FROM schools WHERE id = $1', [SEED_TENANT_ID])
    )[0].seat_limit;
    await dataSource.query('UPDATE schools SET seat_limit = 0 WHERE id = $1', [SEED_TENANT_ID]);
    const [{ n }] = await dataSource.query(
      `SELECT count(*)::int AS n FROM students
        WHERE tenant_id = $1 AND deleted_at IS NULL AND enrollment_status = 'ACTIVE'`,
      [SEED_TENANT_ID],
    );
    if (n === 0) {
      insertedStudentId = randomUUID();
      await dataSource.query(
        `INSERT INTO students (id, tenant_id, full_name, registration_number, roll_number, class_section_id)
         VALUES ($1, $2, 'Walk Student', $3, $4, $5)`,
        [
          insertedStudentId,
          SEED_TENANT_ID,
          `W-${insertedStudentId.slice(0, 8)}`,
          800000 + Math.floor(Math.random() * 100000),
          SEED_SECTION_1_ID,
        ],
      );
    }
    // The status service caches the answer for 5 minutes; start from a clean slate.
    await app.get(TenantStatusService).invalidate(SEED_TENANT_ID);
    // Rule 20 snapshot: a write route is in scope when ANY school-role column is PASS (not only
    // ADMIN). ContextGuard runs before PermissionsGuard, so the ADMIN token gets TENANT_READ_ONLY
    // on every one of them, whichever role could normally pass.
    const adminPasses = new Set<string>();
    const lines = readFileSync(join(__dirname, 'route-status.snapshot.txt'), 'utf8').split('\n');
    const header = lines
      .find((l) => l.startsWith('# columns:'))!
      .replace('# columns:', '')
      .trim();
    const columns = header.split(/\s+/);
    const schoolRoleIdx = columns
      .map((c, i) => (c === 'ANON' || c === 'PLATFORM_SA' ? -1 : i))
      .filter((i) => i >= 0);
    for (const line of lines) {
      if (line.startsWith('#') || !line.trim()) continue;
      const [method, label, ...cells] = line.trim().split(/\s+/);
      if (WRITE_METHODS.includes(method) && schoolRoleIdx.some((i) => cells[i] === 'PASS')) {
        adminPasses.add(`${method} ${label}`);
      }
    }

    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const routes: {
      method: string;
      path: string;
      label: string;
      allowed: boolean;
      userLevel: boolean;
    }[] = [];
    for (const { metatype } of discovery.getControllers()) {
      if (!metatype) continue;
      const prefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
      const classVersion = Reflect.getMetadata(VERSION_METADATA, metatype);
      for (const name of scanner.getAllMethodNames(metatype.prototype)) {
        const handler = metatype.prototype[name];
        const m: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (m === undefined) continue;
        const method = RequestMethodName(m);
        if (!WRITE_METHODS.includes(method)) continue;
        const version = Reflect.getMetadata(VERSION_METADATA, handler) ?? classVersion;
        const base = `/api${version === VERSION_NEUTRAL ? '' : '/v1'}`;
        const template = buildFullPath(prefix, Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        if (!adminPasses.has(`${method} ${base + template}`)) continue;
        // Public and account-scoped routes (login, reset, invites, public admission) sit outside
        // ContextGuard on purpose: they are not "this school" requests. Everything else in a
        // school must run ContextGuard, and that is what this walk proves.
        const guards: unknown[] = [
          ...(Reflect.getMetadata(GUARDS_METADATA, metatype) ?? []),
          ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
        ];
        if (!guards.includes(ContextGuard)) continue;
        const userLevel = Reflect.getMetadata(ALLOW_WHEN_READ_ONLY_KEY, handler) === true;
        routes.push({
          method,
          path: base + template.replace(/:[A-Za-z0-9_]+/g, SEED_TENANT_ID),
          label: `${method} ${base + template}`,
          allowed:
            userLevel ||
            Reflect.getMetadata(ALLOW_WHEN_SUSPENDED_FOR_BILLING_KEY, handler) === true,
          userLevel,
        });
      }
    }
    // The user-level writes are walked (they run ContextGuard) and are exactly the expected set.
    expect(
      routes
        .filter((r) => r.userLevel)
        .map((r) => r.label)
        .sort(),
    ).toEqual(USER_LEVEL_WRITES);
    // Guard against a vacuous pass: the snapshot has hundreds of ADMIN-reachable writes.
    expect(routes.length).toBeGreaterThan(100);

    const results: { label: string; allowed: boolean; code?: string; status: number }[] = [];
    for (let i = 0; i < routes.length; i += BATCH) {
      results.push(
        ...(await Promise.all(
          routes.slice(i, i + BATCH).map(async (r) => ({
            label: r.label,
            allowed: r.allowed,
            ...(await send(r.method, r.path)),
          })),
        )),
      );
    }

    // Every non-allowed write: 403 + TENANT_READ_ONLY. Listed by name so a failure says which.
    const leaked = results
      .filter((r) => !r.allowed && !(r.status === 403 && r.code === 'TENANT_READ_ONLY'))
      .map((r) => `${r.label} -> ${r.status} ${r.code}`);
    expect(leaked).toEqual([]);

    // The pay-to-reopen routes must stay reachable (they may still fail later on permission).
    const wronglyBlocked = results
      .filter((r) => r.allowed && r.code === 'TENANT_READ_ONLY')
      .map((r) => r.label);
    expect(wronglyBlocked).toEqual([]);

    // Reads are never blocked: a GET and a HEAD-style read still reach the handler.
    const read = await send('GET', '/api/v1/academic-years');
    expect(read.code).not.toBe('TENANT_READ_ONLY');
  }, 300000);
});
