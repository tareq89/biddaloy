import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
} from '@test/constants';

/**
 * E2E tests for the `attendance` routes — allowed/denied per role, missing/
 * invalid `X-Tenant-ID`, and the section-level object access that
 * `@Roles(...)` alone can't express (a TEACHER mapped to one section but
 * not another).
 *
 * `teachers`/`teacher_class_sections`/`students` are "transactional" tables
 * (see `test/reset-order.ts`) — truncated before *every* test, even here.
 * So the teacher-to-section mapping and the roster are re-seeded in this
 * file's own `beforeEach`, not once in `beforeAll`.
 */
describe('Attendance E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let studentId: string;

  const TENANT_ID = SEED_TENANT_ID;
  const MAPPED_SECTION_ID = SEED_SECTION_1_ID;
  const UNMAPPED_SECTION_ID = SEED_SECTION_2_ID;

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

    // Disables the default Friday weekly-off so PUT/finalize/PATCH tests
    // below aren't at the mercy of which real-world weekday the suite runs
    // on. `schools` is a reference table (reset once per file, not per
    // test), so this survives for every test in this file.
    await dataSource.query(`UPDATE schools SET settings = $1 WHERE id = $2`, [
      JSON.stringify({ version: 1, attendance: { weeklyOffDays: [] } }),
      TENANT_ID,
    ]);

    // The seeded admin also acts as ADMIN for the tenant-wide routes.
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
    // `user_tenants` is a reference table (persists per file); the seeded
    // admin also acts as TEACHER via X-Role, same pattern as
    // `subjects.e2e-spec.ts`.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    // `teachers`/`teacher_class_sections`/`students` are transactional —
    // reseed every test. The teacher is mapped to `MAPPED_SECTION_ID` only.
    const teacherId = randomUUID();
    await dataSource.query(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'E2E-TEACHER', '{}', $3, NOW(), NOW())`,
      [teacherId, SEED_ADMIN_USER_ID, TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), teacherId, MAPPED_SECTION_ID, TENANT_ID],
    );

    const studentRes = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
       VALUES ($1, 'E2E Student', 'E2E-REG-1', 1, $2, $3, 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [randomUUID(), MAPPED_SECTION_ID, TENANT_ID],
    );
    studentId = studentRes[0].id;
  });

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  describe('GET /attendance/my-sections', () => {
    it('returns 200 for a TEACHER', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/attendance/my-sections')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((s: { section_id: string }) => s.section_id === MAPPED_SECTION_ID)).toBe(
        true,
      );
    });

    it('returns 401 when X-Tenant-ID is missing', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/attendance/my-sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });
  });

  describe('GET /attendance/sections/:sectionId/register', () => {
    it('returns 200 for a TEACHER mapped to the section', async () => {
      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/register`)
        .query({ date: todayIso() })
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);

      expect(
        res.body.students.some((s: { student_id: string }) => s.student_id === studentId),
      ).toBe(true);
    });

    it('returns 403 for a TEACHER not mapped to the section', async () => {
      await supertest(app.getHttpServer())
        .get(`/api/v1/attendance/sections/${UNMAPPED_SECTION_ID}/register`)
        .query({ date: todayIso() })
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(403);
    });
  });

  describe('PUT /attendance/sections/:sectionId/register', () => {
    it('submits a register as a mapped TEACHER', async () => {
      const res = await supertest(app.getHttpServer())
        .put(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/register`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({
          date: todayIso(),
          base_version: 0,
          client_request_id: randomUUID(),
          entries: [{ student_id: studentId, status: 'PRESENT' }],
        })
        .expect(200);

      expect(res.body.session.version).toBe(1);
    });

    it('returns 403 for a TEACHER not mapped to the section', async () => {
      await supertest(app.getHttpServer())
        .put(`/api/v1/attendance/sections/${UNMAPPED_SECTION_ID}/register`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({
          date: todayIso(),
          base_version: 0,
          client_request_id: randomUUID(),
          entries: [],
        })
        .expect(403);
    });

    it("returns 401 for a role not in this route's @Roles list (ACCOUNTANT)", async () => {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.ACCOUNTANT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);

      await supertest(app.getHttpServer())
        .put(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/register`)
        .set('Authorization', `Bearer ${loginRes.body.access_token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({
          date: todayIso(),
          base_version: 0,
          client_request_id: randomUUID(),
          entries: [],
        })
        .expect(401);
    });
  });

  describe('POST /attendance/sections/:sectionId/register/finalize', () => {
    it('finalizes an already-submitted register', async () => {
      const date = todayIso();
      await supertest(app.getHttpServer())
        .put(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/register`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          date,
          base_version: 0,
          client_request_id: randomUUID(),
          entries: [{ student_id: studentId, status: 'PRESENT' }],
        })
        .expect(200);

      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/register/finalize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ date })
        .expect(200);

      expect(res.body.session.state).toBe('FINALIZED');
    });
  });

  describe('PATCH /attendance/records/:recordId', () => {
    it('requires a reason (400 when missing)', async () => {
      const putRes = await supertest(app.getHttpServer())
        .put(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/register`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          date: todayIso(),
          base_version: 0,
          client_request_id: randomUUID(),
          entries: [{ student_id: studentId, status: 'PRESENT' }],
        })
        .expect(200);

      const recordId = putRes.body.students.find(
        (s: { student_id: string; record_id: string }) => s.student_id === studentId,
      ).record_id;

      await supertest(app.getHttpServer())
        .patch(`/api/v1/attendance/records/${recordId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ status: 'LATE', minutes_late: 10 })
        .expect(400);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/attendance/records/${recordId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ status: 'LATE', minutes_late: 10, reason: 'Arrived late today' })
        .expect(200);

      expect(
        res.body.students.find((s: { student_id: string }) => s.student_id === studentId).status,
      ).toBe('LATE');
    });
  });

  describe('GET /attendance/records/:recordId/history', () => {
    it('succeeds for a TEACHER who has no AUDIT_LOG_READ', async () => {
      const putRes = await supertest(app.getHttpServer())
        .put(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/register`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({
          date: todayIso(),
          base_version: 0,
          client_request_id: randomUUID(),
          entries: [{ student_id: studentId, status: 'PRESENT' }],
        })
        .expect(200);

      const recordId = putRes.body.students.find(
        (s: { student_id: string; record_id: string }) => s.student_id === studentId,
      ).record_id;

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/attendance/records/${recordId}/history`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
