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

/** E2E for `GET /dashboard/widgets/mark-entry-progress` (#1850): D46 role matrix + tenant gate. */

const API = '/api/v1';
const URL = `${API}/dashboard/widgets/mark-entry-progress`;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000185000a1';

describe('GET /dashboard/widgets/mark-entry-progress', () => {
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
       VALUES ($1, 'mark-entry-other', 'mark-entry-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
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
      `tenant:${SEED_TENANT_ID}:dash:v1:${DashboardWidgetKey.MARK_ENTRY_PROGRESS}:school`,
    );
    await app.close();
  });

  const allowed = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.EXAM_CONTROLLER];

  it('catalogue roles are exactly ADMIN, EXECUTIVE, EXAM_CONTROLLER', () => {
    expect([...WIDGET_CATALOGUE['mark-entry-progress'].roles].sort()).toEqual([...allowed].sort());
  });

  it.each(allowed)('200 for %s, empty state when no exam is in progress', async (role) => {
    const res = await call(role).expect(200);
    expect(res.body).toMatchObject({ exam_name: null, classes: [], lowest_class_id: null });
  });

  it.each([
    UserRole.ACCOUNTANT,
    UserRole.TEACHER,
    UserRole.OFFICE_STAFF,
    UserRole.COMMITTEE,
    UserRole.PARENT,
    UserRole.STUDENT,
  ])('403 for %s', async (role) => {
    await call(role).expect(403);
  });

  it("another tenant's X-Tenant-ID is refused (401/403)", async () => {
    const res = await call(UserRole.ADMIN, OTHER_TENANT_ID);
    expect([401, 403]).toContain(res.status);
  });

  // server/CLAUDE.md: always test a missing X-Tenant-ID.
  it('missing X-Tenant-ID returns 401', async () => {
    await supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
