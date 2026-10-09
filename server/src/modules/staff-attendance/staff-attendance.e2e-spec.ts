import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { AttendanceStatus } from '@biddaloy/shared';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * E2E tests for the `staff-attendance` routes: mark a day, correct it
 * outside the correction window with a reason, fetch the summary. See
 * `attendance.e2e-spec.ts` for the pattern this mirrors.
 */
describe('Staff Attendance E2E', () => {
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
  const OUTSIDE_WINDOW = () => addDays(-10);

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

    await dataSource.query(`UPDATE schools SET settings = $1 WHERE id = $2`, [
      JSON.stringify({
        version: 1,
        attendance: { weeklyOffDays: [], correctionWindowDays: 2, allowFutureDates: false },
      }),
      TENANT_ID,
    ]);

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
    // `staff_profiles`/`users` are transactional tables (truncated before
    // every test) — re-seed a staff profile to mark against per test.
    const userRes = await dataSource.query(
      `INSERT INTO users (id, email, full_name, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'E2E Staff', NOW(), NOW()) RETURNING id`,
      [`staff-att-e2e-${Date.now()}-${Math.random()}@test.com`],
    );
    const userId = userRes[0].id;
    const profileRes = await dataSource.query(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [userId, TENANT_ID, `EMP-E2E-${Date.now()}`],
    );
    staffProfileId = profileRes[0].id;
  });

  it('marks a day, corrects it outside the window with a reason, and fetches the summary', async () => {
    const date = OUTSIDE_WINDOW();

    await supertest(app.getHttpServer())
      .put('/api/v1/staff-attendance/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        date,
        entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.PRESENT }],
      })
      .expect(200);

    // Correcting outside the window without a reason is rejected.
    await supertest(app.getHttpServer())
      .put('/api/v1/staff-attendance/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        date,
        entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.ABSENT }],
      })
      .expect(422);

    // With a reason it succeeds.
    const correctRes = await supertest(app.getHttpServer())
      .put('/api/v1/staff-attendance/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        date,
        reason: 'late correction',
        entries: [{ staff_profile_id: staffProfileId, status: AttendanceStatus.ABSENT }],
      })
      .expect(200);
    expect(correctRes.body.records[0].status).toBe(AttendanceStatus.ABSENT);

    const summaryRes = await supertest(app.getHttpServer())
      .get('/api/v1/staff-attendance/summary')
      .query({ staff_profile_id: staffProfileId, from: date, to: date })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);
    expect(summaryRes.body.absent_days).toBe(1);
  });

  it('rejects an unauthenticated request', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/staff-attendance/summary')
      .query({ staff_profile_id: staffProfileId, from: OUTSIDE_WINDOW(), to: OUTSIDE_WINDOW() })
      .set('X-Tenant-ID', TENANT_ID)
      .expect(401);
  });
});
