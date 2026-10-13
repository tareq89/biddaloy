import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** [13.2.1] A teacher leaves a school; their next token refresh no longer lists it. */
describe('POST /users/me/leave (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const OTHER_TENANT = '00000000-0000-4000-8000-000000000391';
  const TEACHER_ID = '00000000-0000-4000-8000-000000000392';
  const EMAIL = 'leaver-1321@example.com';
  // Stays a member throughout: used for the denied-role checks.
  const STAFF_ID = '00000000-0000-4000-8000-000000000393';
  const STAFF_EMAIL = 'staff-1321@example.com';
  const PARENT_ID = '00000000-0000-4000-8000-000000000394';
  const FORMER_ID = '00000000-0000-4000-8000-000000000395';
  const REMOVED_ID = '00000000-0000-4000-8000-000000000396';
  const REMOVED_EMAIL = 'removed-2297@example.com';
  const REMOVED2_ID = '00000000-0000-4000-8000-000000000397';
  const REMOVED2_EMAIL = 'removed2-2297@example.com';
  const REMOVED3_ID = '00000000-0000-4000-8000-000000000398';
  const REMOVED3_EMAIL = 'removed3-2310@example.com';
  const PARENT_EMAIL = 'parent-1321@example.com';

  async function tokenFor(email: string): Promise<string> {
    const res = await request()
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  const request = () => supertest(app.getHttpServer());

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.use(cookieParser()); // refresh reads its token from the cookie
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Leave E2E Other School', 'leave-e2e-other', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_TENANT],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Leaving Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [TEACHER_ID, EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    for (const [id, email, role] of [
      [STAFF_ID, STAFF_EMAIL, UserRole.TEACHER],
      [PARENT_ID, PARENT_EMAIL, UserRole.PARENT],
      [REMOVED_ID, REMOVED_EMAIL, UserRole.ACCOUNTANT],
      [REMOVED2_ID, REMOVED2_EMAIL, UserRole.ACCOUNTANT],
      [REMOVED3_ID, REMOVED3_EMAIL, UserRole.ACCOUNTANT],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Denied Role', 'ACTIVE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }
    for (const tenant of [SEED_TENANT_ID, OTHER_TENANT]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [TEACHER_ID, tenant, UserRole.TEACHER],
      );
    }
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [REMOVED2_ID, OTHER_TENANT, UserRole.ACCOUNTANT],
    );
  }, 60000);

  afterAll(async () => {
    // Best-effort: audit_logs is append-only, so the school and user may stay behind.
    const ids = [TEACHER_ID, STAFF_ID, PARENT_ID, FORMER_ID, REMOVED_ID, REMOVED2_ID, REMOVED3_ID];
    await dataSource.query('DELETE FROM user_tenants WHERE user_id = ANY($1)', [ids]);
    await dataSource.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [ids]);
    await app.close();
  });

  it('leaving a school drops it from the next refreshed token, the other school stays', async () => {
    const login = await request()
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    expect(login.body.memberships.map((m: { tenantId: string }) => m.tenantId).sort()).toEqual(
      [SEED_TENANT_ID, OTHER_TENANT].sort(),
    );
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('__Host-refresh_token='),
    )!;
    const refreshCookie = `__Host-refresh_token=${decodeURIComponent(cookie.split(';')[0].split('=')[1])}`;

    await request()
      .post('/api/v1/users/me/leave')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(204);

    const refreshed = await request()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    expect(refreshed.body.memberships.map((m: { tenantId: string }) => m.tenantId)).toEqual([
      OTHER_TENANT,
    ]);
  });

  // [68.4 AUTH-07] Removal is immediate: the removed user's live access token dies at once.
  it('removing a member makes their existing access token 401; others and a fresh login are fine', async () => {
    const removedToken = await tokenFor(REMOVED_EMAIL);
    const bystanderToken = await tokenFor(STAFF_EMAIL);
    const adminToken = await tokenFor(SEED_ADMIN_EMAIL);
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${removedToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    await request()
      .delete(`/api/v1/users/${REMOVED_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${removedToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
    // Another user's live token in the same school is untouched.
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${bystanderToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);
    // A fresh login no longer lists the school, and its token is refused there
    // (401: ContextGuard treats a non-member as unauthenticated, not 403).
    const fresh = await request()
      .post('/api/v1/auth/login')
      .send({ email: REMOVED_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const tenants = fresh.body.memberships.map((m: { tenantId: string }) => m.tenantId);
    expect(tenants).not.toContain(SEED_TENANT_ID);
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${fresh.body.access_token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });

  // [75.2, D12] The DB cut-off alone refuses the token: wipe the Redis user cut-off
  // (best-effort, fail-open) and the old token is still 401.
  it('a removed member stays cut off without Redis (users.tokens_valid_after)', async () => {
    const token = await tokenFor(REMOVED3_EMAIL);
    const adminToken = await tokenFor(SEED_ADMIN_EMAIL);
    await request()
      .delete(`/api/v1/users/${REMOVED3_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    await redis.del(`access-denylist:user:${REMOVED3_ID}`);
    redis.disconnect();

    const [{ tokens_valid_after }] = await dataSource.query(
      'SELECT tokens_valid_after FROM users WHERE id = $1',
      [REMOVED3_ID],
    );
    expect(tokens_valid_after).not.toBeNull();
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });

  // The cut-off is per user, so the old token also dies for the user's other school;
  // the client refreshes on 401 and carries on there.
  it('a removed user keeps working in their other school after one refresh', async () => {
    const login = await request()
      .post('/api/v1/auth/login')
      .send({ email: REMOVED2_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('__Host-refresh_token='),
    )!;
    const refreshCookie = `__Host-refresh_token=${decodeURIComponent(cookie.split(';')[0].split('=')[1])}`;
    const adminToken = await tokenFor(SEED_ADMIN_EMAIL);

    await request()
      .delete(`/api/v1/users/${REMOVED2_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .set('X-Tenant-ID', OTHER_TENANT)
      .expect(401);
    const refreshed = await request()
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .expect(200);
    await request()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${refreshed.body.access_token}`)
      .set('X-Tenant-ID', OTHER_TENANT)
      .expect(200);
  });

  it('a TEACHER cannot restore a member (403)', async () => {
    await request()
      .post(`/api/v1/users/${TEACHER_ID}/restore`)
      .set('Authorization', `Bearer ${await tokenFor(STAFF_EMAIL)}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('a PARENT cannot leave (403)', async () => {
    await request()
      .post('/api/v1/users/me/leave')
      .set('Authorization', `Bearer ${await tokenFor(PARENT_EMAIL)}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('an admin cannot restore someone who left a DIFFERENT school (404, tenant isolation)', async () => {
    // FORMER_ID has a soft-deleted row in OTHER_TENANT only.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'former-1321@example.com', $2, 'Former Elsewhere', 'ACTIVE', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [FORMER_ID, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [FORMER_ID, OTHER_TENANT, UserRole.TEACHER],
    );
    await request()
      .post(`/api/v1/users/${FORMER_ID}/restore`)
      .set('Authorization', `Bearer ${await tokenFor(SEED_ADMIN_EMAIL)}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(404);
  });
});

/** [68.1.#2209] One login, many schools: a school may not retarget a shared person's login. */
describe('shared identity (68.1.#2209) (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const OTHER_TENANT = '00000000-0000-4000-8000-000000002091';
  const SHARED_ID = '00000000-0000-4000-8000-000000002092';
  const SOLO_ID = '00000000-0000-4000-8000-000000002093';
  const ELSEWHERE_ID = '00000000-0000-4000-8000-000000002094';
  const SHARED_EMAIL = 'shared-2209@example.com';
  const ids = [SHARED_ID, SOLO_ID, ELSEWHERE_ID];

  const request = () => supertest(app.getHttpServer());
  const adminToken = async () =>
    (
      await request()
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
  const count = async (sql: string, params: unknown[]) =>
    Number((await dataSource.query(sql, params))[0].n);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Shared Identity Other School', 'shared-identity-2209', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [OTHER_TENANT],
    );
    for (const [id, email] of [
      [SHARED_ID, SHARED_EMAIL],
      [SOLO_ID, 'solo-2209@example.com'],
      [ELSEWHERE_ID, 'elsewhere-2209@example.com'],
    ]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Identity Person', 'ACTIVE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
    }
    for (const [id, tenant, role] of [
      [SHARED_ID, SEED_TENANT_ID, UserRole.TEACHER],
      [SHARED_ID, OTHER_TENANT, UserRole.ADMIN],
      [SOLO_ID, SEED_TENANT_ID, UserRole.TEACHER],
      [ELSEWHERE_ID, OTHER_TENANT, UserRole.TEACHER],
    ]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, tenant, role],
      );
    }
  }, 60000);

  afterAll(async () => {
    await dataSource.query('DELETE FROM user_tenants WHERE user_id = ANY($1)', [ids]);
    await dataSource.query('DELETE FROM refresh_tokens WHERE user_id = ANY($1)', [ids]);
    await app.close();
  });

  it('B admin gets 409 SHARED_IDENTITY on PATCH email of a user also in another school; DB unchanged', async () => {
    const res = await request()
      .patch(`/api/v1/users/${SHARED_ID}`)
      .set('Authorization', `Bearer ${await adminToken()}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ email: 'attacker@evil.test' })
      .expect(409);
    expect(JSON.stringify(res.body)).toContain('SHARED_IDENTITY');
    const [row] = await dataSource.query('SELECT email FROM users WHERE id = $1', [SHARED_ID]);
    expect(row.email).toBe(SHARED_EMAIL);
  });

  it('B admin gets 409 on reset-password of a shared user: no token, no log, no session revoked', async () => {
    await dataSource.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, created_at)
       VALUES ($1, gen_random_uuid(), 'hash-2209', NOW() + interval '1 day', NOW())`,
      [SHARED_ID],
    );
    const tokens = 'SELECT count(*) n FROM auth_tokens WHERE user_id = $1';
    const logs = 'SELECT count(*) n FROM communication_logs WHERE recipient_address = $1';
    const tokensBefore = await count(tokens, [SHARED_ID]);
    const logsBefore = await count(logs, [SHARED_EMAIL]);
    await request()
      .post(`/api/v1/users/${SHARED_ID}/reset-password`)
      .set('Authorization', `Bearer ${await adminToken()}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(409);
    expect(await count(tokens, [SHARED_ID])).toBe(tokensBefore);
    expect(await count(logs, [SHARED_EMAIL])).toBe(logsBefore);
    expect(
      await count(
        'SELECT count(*) n FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NOT NULL',
        [SHARED_ID],
      ),
    ).toBe(0);
  });

  it('B admin can still PATCH the email of a user who belongs only to B (200)', async () => {
    await request()
      .patch(`/api/v1/users/${SOLO_ID}`)
      .set('Authorization', `Bearer ${await adminToken()}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ email: 'solo-2209-new@example.com' })
      .expect(200);
  });

  it('B admin gets 404 on PATCH of a user with no membership in B', async () => {
    await request()
      .patch(`/api/v1/users/${ELSEWHERE_ID}`)
      .set('Authorization', `Bearer ${await adminToken()}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ email: 'x-2209@example.com' })
      .expect(404);
  });
});
