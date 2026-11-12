import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { ACCESS_TOKEN_DENYLIST_REDIS } from '../../auth/access-token-denylist.service';
import { COCKPIT_REDIS } from '../../auth/cockpit/cockpit-session.service';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { mintCockpitToken, removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** [75.34] `GET /platform/alerts`: platform SUPER_ADMIN only, answered from Postgres. */
describe('Platform Alerts E2E', () => {
  let app: INestApplication;
  let redisDownApp: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let ownerToken: string;

  const URL = '/api/v1/platform/alerts';
  const TEACHER_USER_ID = '00000000-0000-4000-8000-0000000c0d03';
  const TEACHER_EMAIL = 'teacher@platform-alerts-e2e.example';
  const PARENT_USER_ID = '00000000-0000-4000-8000-0000000c0d04';
  const PARENT_EMAIL = 'parent@platform-alerts-e2e.example';
  // [75.34 review r1] SUPER_ADMIN on the seed tenant only: school-local, not platform.
  const TENANT_SA_USER_ID = '00000000-0000-4000-8000-0000000c0d06';
  const TENANT_SA_EMAIL = 'tenant-sa@platform-alerts-e2e.example';

  async function boot(configure: (b: ReturnType<typeof Test.createTestingModule>) => void) {
    const builder = Test.createTestingModule({ imports: [AppModule] });
    configure(builder);
    const moduleFixture: TestingModule = await builder.compile();
    const instance = moduleFixture.createNestApplication();
    configureApiVersioning(instance);
    instance.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await instance.init();
    return instance;
  }

  const loginAs = async (target: INestApplication, email: string) => {
    const res = await supertest(target.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token as string;
  };

  const get = (target: INestApplication, token?: string, tenant: string | null = null) => {
    let req = supertest(target.getHttpServer()).get(URL);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (tenant) req = req.set('X-Tenant-ID', tenant);
    return req;
  };

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    app = await boot(() => undefined);
    dataSource = app.get(DataSource);

    for (const [id, email, role] of [
      [TEACHER_USER_ID, TEACHER_EMAIL, UserRole.TEACHER],
      [PARENT_USER_ID, PARENT_EMAIL, UserRole.PARENT],
      [TENANT_SA_USER_ID, TENANT_SA_EMAIL, UserRole.SUPER_ADMIN],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Platform Alerts E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(`DELETE FROM platform_alerts`);

    adminToken = await loginAs(app, SEED_ADMIN_EMAIL);
    ownerToken = await mintCockpitToken(app, dataSource);
  }, 60000);

  afterAll(async () => {
    await removeCockpitOwners(dataSource);
    await dataSource.query(`DELETE FROM platform_alerts`);
    await redisDownApp?.close();
    await app.close();
  });

  it('lets a platform owner read an empty list, then an open alert, then an empty list again', async () => {
    await dataSource.query(`DELETE FROM platform_alerts`);
    let res = await get(app, ownerToken).expect(200);
    expect(res.body).toEqual({ alerts: [] });

    await dataSource.query(
      `INSERT INTO platform_alerts (kind, opened_at) VALUES ('REDIS_DOWN', '2026-11-02T08:02:10Z')`,
    );
    res = await get(app, ownerToken).expect(200);
    expect(res.body).toEqual({
      alerts: [{ kind: 'REDIS_DOWN', opened_at: '2026-11-02T08:02:10.000Z' }],
    });

    await dataSource.query(`UPDATE platform_alerts SET cleared_at = now()`);
    res = await get(app, ownerToken).expect(200);
    expect(res.body).toEqual({ alerts: [] });
  });

  it('refuses a school-local SUPER_ADMIN with 403 (PlatformAccessGuard)', async () => {
    await get(app, await loginAs(app, TENANT_SA_EMAIL), SEED_TENANT_ID).expect(403);
  });

  it('refuses ADMIN, TEACHER and PARENT with 403', async () => {
    await get(app, adminToken, SEED_TENANT_ID).expect(403);
    await get(app, await loginAs(app, TEACHER_EMAIL), SEED_TENANT_ID).expect(403);
    await get(app, await loginAs(app, PARENT_EMAIL), SEED_TENANT_ID).expect(403);
  });

  it('refuses no token with 401', async () => {
    await get(app).expect(401);
  });

  it('answers 503, not an open door, while the cockpit session store is unreachable (Rule 15)', async () => {
    await dataSource.query(`DELETE FROM platform_alerts`);
    await dataSource.query(`INSERT INTO platform_alerts (kind) VALUES ('REDIS_DOWN')`);

    // Every call on these two clients rejects, as if Redis were gone. The token comes from the
    // first (healthy) app, so this exercises JwtStrategy + ContextGuard with a dead denylist/cache.
    // Only Redis commands reject; every other property is undefined so Nest's lifecycle-hook
    // lookup and `await` leave the stub alone.
    const commands = new Set([
      'get',
      'set',
      'mget',
      'del',
      'incr',
      'expire',
      'pexpire',
      'hset',
      'hget',
      'ping',
    ]);
    const dead = new Proxy(
      {},
      {
        get: (_t, key) =>
          typeof key === 'string' && commands.has(key)
            ? () => Promise.reject(new Error('redis is down'))
            : undefined,
      },
    );
    redisDownApp = await boot((b) =>
      b
        .overrideProvider(ACCESS_TOKEN_DENYLIST_REDIS)
        .useValue(dead)
        .overrideProvider(TENANT_STATUS_REDIS)
        .useValue(dead)
        .overrideProvider(COCKPIT_REDIS)
        .useValue(dead),
    );

    // Epic 98 wave 5: the route is cockpit-only now, and a cockpit session check fails closed
    // (Rule 15), so the list is unreachable while Redis is down. The alert itself still goes out
    // by SMS (PlatformAlertsService does not touch Redis). Follow-up filed in the lane report.
    await get(redisDownApp, ownerToken).expect(503);
  }, 60000);
});
