import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { LeaveType, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * E2E test for the `leave` routes: balance, policies, and the removed request routes. See `staff-attendance.e2e-spec.ts` for the pattern
 * this mirrors.
 */
describe('Leave E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let staffProfileId: string;

  const TENANT_ID = SEED_TENANT_ID;

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
  function addDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return isoDate(d);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);

    const adminLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = adminLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // `leave_policies`/`staff_profiles`/`users` are all transactional
    // tables (truncated before every test, `test/reset-order.ts`) — reseed
    // per test rather than once in `beforeAll`, which would only survive
    // the first test in this file.
    //
    // The seed tenant is created by test global-setup after the migration
    // ran, so it never got the migration's per-tenant D9 seed rows — upsert
    // all five here (GET /leave/balance reads every LeaveType) rather than
    // assuming they exist.
    await dataSource.query(
      `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days, created_at, updated_at)
       SELECT gen_random_uuid(), $1, v.leave_type, v.quota, NOW(), NOW()
       FROM (VALUES
         ('CASUAL'::leave_type_enum, 10), ('SICK'::leave_type_enum, 14),
         ('EARNED'::leave_type_enum, 15), ('MATERNITY'::leave_type_enum, 112),
         ('PATERNITY'::leave_type_enum, 7)
       ) AS v(leave_type, quota)
       ON CONFLICT (tenant_id, leave_type) DO UPDATE SET annual_quota_days = EXCLUDED.annual_quota_days`,
      [TENANT_ID],
    );

    const userRes = await dataSource.query(
      `INSERT INTO users (id, email, full_name, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'E2E Leave Staff', NOW(), NOW()) RETURNING id`,
      [`leave-e2e-${Date.now()}-${Math.random()}@test.com`],
    );
    const userId = userRes[0].id;
    const profileRes = await dataSource.query(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [userId, TENANT_ID, `EMP-LEAVE-E2E-${Date.now()}`],
    );
    staffProfileId = profileRes[0].id;
  });

  it('POST /leave/requests and /decide are gone (D20); the balance read still works', async () => {
    await supertest(app.getHttpServer())
      .post('/api/v1/leave/requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        staff_profile_id: staffProfileId,
        leave_type: LeaveType.CASUAL,
        start_date: addDays(1),
        end_date: addDays(3),
      })
      .expect(404);

    const balanceRes = await supertest(app.getHttpServer())
      .get('/api/v1/leave/balance')
      .query({ staff_profile_id: staffProfileId })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);
    expect(balanceRes.body.find((b: any) => b.leave_type === 'CASUAL').balance).toBe(10);
  });

  it('returns 401 when X-Tenant-ID is missing', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/leave/balance')
      .query({ staff_profile_id: staffProfileId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
  });

  it("returns 401 when X-Tenant-ID is not one of the caller's memberships", async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/leave/balance')
      .query({ staff_profile_id: staffProfileId })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', randomUUID())
      .expect(401);
  });

  it('returns 403 for a non-LEAVE_APPROVE role (STUDENT) on PUT /leave/policies/:type', async () => {
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    // Re-login so the token carries the new STUDENT membership (it is embedded at login).
    const studentLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const studentToken = studentLoginRes.body.access_token;

    await supertest(app.getHttpServer())
      .put(`/api/v1/leave/policies/${LeaveType.CASUAL}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .send({ annual_quota_days: 12 })
      .expect(403);
  });
});
