import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { DashboardWidgetKey, UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/** E2E for `GET /dashboard/widgets/seat-plan-status` (#1892): D46 role matrix + tenant gate. */

const API = '/api/v1';
const URL = `${API}/dashboard/widgets/seat-plan-status`;
const FOREIGN_TENANT_ID = '00000000-0000-4000-8000-000001892002';

describe('GET /dashboard/widgets/seat-plan-status', () => {
  let app: INestApplication;
  let redis: Redis;
  let token: string;

  const call = (role: UserRole, tenantId = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId)
      .set('X-Role', role);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);
    redis = app.get<Redis>(TENANT_STATUS_REDIS);

    // One login, one membership per role, switched with X-Role.
    for (const role of Object.values(UserRole)) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'seat-plan-other', 'seat-plan-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [FOREIGN_TENANT_ID],
    );
    token = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 120000);

  afterAll(async () => {
    await redis.del(
      `tenant:${SEED_TENANT_ID}:dash:v1:${DashboardWidgetKey.SEAT_PLAN_STATUS}:school`,
    );
    await app.close();
  });

  it('catalogue roles are exactly EXAM_CONTROLLER and ADMIN', () => {
    expect([...WIDGET_CATALOGUE['seat-plan-status'].roles].sort()).toEqual(
      [UserRole.ADMIN, UserRole.EXAM_CONTROLLER].sort(),
    );
  });

  it('200 for ADMIN, empty state, keys match the DTO', async () => {
    const res = await call(UserRole.ADMIN).expect(200);
    expect(res.body).toEqual({ exams_needing_plan: 0, exams: [] });
  });

  it('200 for EXAM_CONTROLLER', async () => {
    await call(UserRole.EXAM_CONTROLLER).expect(200);
  });

  it('403 for EXECUTIVE', async () => {
    await call(UserRole.EXECUTIVE).expect(403);
  });

  it('403 for ACCOUNTANT', async () => {
    await call(UserRole.ACCOUNTANT).expect(403);
  });

  it('403 for TEACHER', async () => {
    await call(UserRole.TEACHER).expect(403);
  });

  it('403 for OFFICE_STAFF', async () => {
    await call(UserRole.OFFICE_STAFF).expect(403);
  });

  it('403 for COMMITTEE', async () => {
    await call(UserRole.COMMITTEE).expect(403);
  });

  it('403 for PARENT', async () => {
    await call(UserRole.PARENT).expect(403);
  });

  it('403 for STUDENT', async () => {
    await call(UserRole.STUDENT).expect(403);
  });

  it('missing X-Tenant-ID is rejected', async () => {
    const res = await supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', UserRole.ADMIN);
    expect([400, 401, 403]).toContain(res.status);
  });

  it('an invalid (non-UUID) X-Tenant-ID is rejected', async () => {
    const res = await call(UserRole.ADMIN, 'not-a-uuid');
    expect([400, 401, 403]).toContain(res.status);
  });

  it("a caller of school A with school B's X-Tenant-ID is refused (401/403)", async () => {
    const res = await call(UserRole.ADMIN, FOREIGN_TENANT_ID);
    expect([401, 403]).toContain(res.status);
  });
});
