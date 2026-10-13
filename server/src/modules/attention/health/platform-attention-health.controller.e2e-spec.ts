import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** [67.1.09] E2E for `GET /platform/attention/health`: SUPER_ADMIN only, global engine data. */
describe('Platform Attention Health E2E', () => {
  let app: INestApplication;
  let redis: Redis;
  let adminToken: string;
  let superAdminToken: string;
  let tenantSuperAdminToken: string;
  let dataSource: DataSource;
  let platformId: string;

  const URL = '/api/v1/platform/attention/health';
  const SUPER_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000c0d01';
  const SUPER_ADMIN_EMAIL = 'superadmin@platform-attention-health-e2e.example';
  // [75.34 review r1] SUPER_ADMIN on the seed tenant only: school-local, not platform.
  const TENANT_SA_USER_ID = '00000000-0000-4000-8000-0000000c0d05';
  const TENANT_SA_EMAIL = 'tenant-sa@platform-attention-health-e2e.example';
  const FAILING_KEY = 'attention:failing:class.starting';

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);
    redis = app.get(TENANT_STATUS_REDIS, { strict: false });

    for (const [id, email] of [
      [SUPER_ADMIN_USER_ID, SUPER_ADMIN_EMAIL],
      [TENANT_SA_USER_ID, TENANT_SA_EMAIL],
    ]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Platform Attention Health Super Admin', 'ACTIVE', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, UserRole.SUPER_ADMIN],
      );
    }
    // Platform authority = SUPER_ADMIN on the platform tenant, which ContextGuard
    // discovers by slug outside production. The test seed has no such school.
    // Left in place afterwards, like the other specs that add it (parallel files may share it).
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       SELECT $1, 'Platform', 'default-school', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'default-school')`,
      [randomUUID()],
    );
    platformId = (await dataSource.query(`SELECT id FROM schools WHERE slug = 'default-school'`))[0]
      .id;
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, platformId, UserRole.SUPER_ADMIN],
    );

    const loginAs = async (email: string) => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token as string;
    };
    adminToken = await loginAs(SEED_ADMIN_EMAIL);
    superAdminToken = await loginAs(SUPER_ADMIN_EMAIL);
    tenantSuperAdminToken = await loginAs(TENANT_SA_EMAIL);
  });

  afterAll(async () => {
    await redis.del(FAILING_KEY);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
      SUPER_ADMIN_USER_ID,
      platformId,
    ]);
    await app.close();
  });

  it('rejects a school-local SUPER_ADMIN with 403 (PlatformSuperAdminGuard)', async () => {
    await supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${tenantSuperAdminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('rejects ADMIN with 403', async () => {
    await supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(403);
  });

  it('rejects no token with 401', async () => {
    await supertest(app.getHttpServer()).get(URL).expect(401);
  });

  it('lets a platform SUPER_ADMIN read the three sweep keys and a failing rule', async () => {
    await redis.hset(FAILING_KEY, 'count', '3', 'lastError', 'boom');

    const res = await supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    expect(Object.keys(res.body.lastSweep).sort()).toEqual(['DAILY', 'FAST', 'HOURLY']);
    expect(res.body.failingRules).toContainEqual({
      key: 'class.starting',
      lastError: 'boom',
      count: 3,
    });
  });
});
