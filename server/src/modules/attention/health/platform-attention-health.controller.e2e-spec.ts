import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
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

  const URL = '/api/v1/platform/attention/health';
  const SUPER_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000c0d01';
  const SUPER_ADMIN_EMAIL = 'superadmin@platform-attention-health-e2e.example';
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

    const dataSource = app.get(DataSource);
    redis = app.get(TENANT_STATUS_REDIS, { strict: false });

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Platform Attention Health Super Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, SUPER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, SEED_TENANT_ID, UserRole.SUPER_ADMIN],
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
  });

  afterAll(async () => {
    await redis.del(FAILING_KEY);
    await app.close();
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

  it('lets SUPER_ADMIN read the three sweep keys and a failing rule', async () => {
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
