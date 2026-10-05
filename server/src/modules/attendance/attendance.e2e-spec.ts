import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { configureBodyParser } from '../../body-parser';
import { NestExpressApplication } from '@nestjs/platform-express';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';
import { seedPeriodRoutine } from './attendance-periods.fixture';

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

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureBodyParser(app as NestExpressApplication);
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
    // `teachers.staff_profile_id` is NOT NULL ([36.1.1]) — this raw insert
    // bypasses TypeORM (so `TeacherStaffProfileSubscriber` doesn't fire),
    // hence the `staff_profiles` CTE. `SEED_ADMIN_USER_ID` is reused across
    // many e2e specs, so `ON CONFLICT (user_id)` reuses its profile instead
    // of erroring on the second file to run.
    await dataSource.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-E2E-' || $1, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'E2E-TEACHER', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
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

    it('returns the check-list fields for a TEACHER and for an ADMIN', async () => {
      for (const [token, role] of [
        [teacherToken, UserRole.TEACHER],
        [adminToken, UserRole.ADMIN],
      ] as const) {
        const res = await supertest(app.getHttpServer())
          .get('/api/v1/attendance/my-sections')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Tenant-ID', TENANT_ID)
          .set('X-Role', role)
          .expect(200);
        const item = res.body.find(
          (x: { section_id: string }) => x.section_id === MAPPED_SECTION_ID,
        );
        expect(typeof item.class_id).toBe('string');
        expect(typeof item.is_working_day).toBe('boolean');
        expect(item).toHaveProperty('class_teacher_name');
      }
    });

    it('returns 400 ATTENDANCE_FUTURE_DATE for a future date', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/attendance/my-sections')
        .query({ date: '2999-01-01' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(400);
      expect(res.body.details.code).toBe('ATTENDANCE_FUTURE_DATE');
    });

    it('returns 401 when X-Tenant-ID is missing', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/attendance/my-sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it("returns 401 when X-Tenant-ID is not one of the caller's memberships", async () => {
      const foreignTenantId = randomUUID();
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/attendance/my-sections')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', foreignTenantId)
        .expect(401);

      expect(res.body.message).toBe(`User is not a member of tenant ${foreignTenantId}`);
    });

    it("returns 403 for a role not in this route's @Roles list (STUDENT)", async () => {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);

      await supertest(app.getHttpServer())
        .get('/api/v1/attendance/my-sections')
        .set('Authorization', `Bearer ${loginRes.body.access_token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(403);
    });
  });

  describe('PUT /attendance/sections/:sectionId/register-matrix', () => {
    const putMatrix = (sectionId: string, body: Record<string, unknown>) =>
      supertest(app.getHttpServer())
        .put(`/api/v1/attendance/sections/${sectionId}/register-matrix`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send(body);

    it('saves today for a TEACHER mapped to the section (inside the window)', async () => {
      const res = await putMatrix(MAPPED_SECTION_ID, {
        client_request_id: randomUUID(),
        days: [
          {
            date: todayIso(),
            base_version: null,
            entries: [{ student_id: studentId, status: 'PRESENT' }],
          },
        ],
      }).expect(200);
      expect(res.body.saved_dates).toEqual([todayIso()]);
      expect(typeof res.body.versions[todayIso()]).toBe('number');
    });

    it('rejects fields the matrix does not take (period_no) with 400', async () => {
      await putMatrix(MAPPED_SECTION_ID, {
        client_request_id: randomUUID(),
        days: [{ date: todayIso(), base_version: null, period_no: 1, entries: [] }],
      }).expect(400);
    });

    it('403s a TEACHER not mapped to the section', async () => {
      await putMatrix(UNMAPPED_SECTION_ID, {
        client_request_id: randomUUID(),
        days: [{ date: todayIso(), base_version: null, entries: [] }],
      }).expect(403);
    });

    it('rejects base_version 0 with 400 (a saved register starts at version 1)', async () => {
      await putMatrix(MAPPED_SECTION_ID, {
        client_request_id: randomUUID(),
        days: [
          {
            date: todayIso(),
            base_version: 0,
            entries: [{ student_id: studentId, status: 'PRESENT' }],
          },
        ],
      }).expect(400);
    });

    // Express's default 100 kB JSON limit would 413 this; see body-parser.ts.
    it('saves a full month for 60 students (well over 100 kB) with 200', async () => {
      await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         SELECT gen_random_uuid(), 'Bulk ' || n, 'E2E-BULK-' || n, n + 1, $1, $2, 'ACTIVE', NOW(), NOW()
         FROM generate_series(1, 59) AS n`,
        [MAPPED_SECTION_ID, TENANT_ID],
      );
      const rows: Array<{ id: string }> = await dataSource.query(
        `SELECT id FROM students WHERE class_section_id = $1 AND tenant_id = $2`,
        [MAPPED_SECTION_ID, TENANT_ID],
      );
      expect(rows).toHaveLength(60);
      // 26 days of a fixed past month, all school days (weeklyOffDays: []).
      const days = Array.from({ length: 26 }, (_, i) => ({
        date: `2026-03-${String(i + 1).padStart(2, '0')}`,
        base_version: null,
        entries: rows.map((r) => ({ student_id: r.id, status: 'PRESENT' })),
      }));
      const body = { client_request_id: randomUUID(), days };
      expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024);

      const res = await putMatrix(MAPPED_SECTION_ID, body).expect(200);
      expect(res.body.saved_dates).toHaveLength(26);
    }, 120000);
  });

  describe('GET /attendance/sections/:sectionId/periods', () => {
    const PDATE = '2026-03-04'; // a Wednesday; the fixture routine puts 2 periods on it

    async function setPeriodSwitch(enabled: boolean) {
      await dataSource.query(`UPDATE schools SET settings = $1 WHERE id = $2`, [
        JSON.stringify({
          version: 1,
          attendance: { weeklyOffDays: [], periodAttendance: { enabled } },
        }),
        TENANT_ID,
      ]);
    }

    const getPeriods = (token: string, role: UserRole) =>
      supertest(app.getHttpServer())
        .get(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/periods`)
        .query({ date: PDATE })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', role);

    afterEach(async () => {
      // `schools` persists for the whole file — put the baseline back.
      await dataSource.query(`UPDATE schools SET settings = $1 WHERE id = $2`, [
        JSON.stringify({ version: 1, attendance: { weeklyOffDays: [] } }),
        TENANT_ID,
      ]);
    });

    it('lists the periods of a published routine for a TEACHER mapped to the section', async () => {
      await seedPeriodRoutine(dataSource, {
        tenantId: TENANT_ID,
        academicYearId: SEED_ACADEMIC_YEAR_ID,
        sectionId: MAPPED_SECTION_ID,
        date: PDATE,
        periods: 2,
        createdBy: SEED_ADMIN_USER_ID,
      });
      await setPeriodSwitch(true);
      const res = await getPeriods(teacherToken, UserRole.TEACHER).expect(200);
      expect(res.body.map((p: { period_no: number }) => p.period_no)).toEqual([1, 2]);
      expect(res.body[0]).toMatchObject({ state: null });
      expect(typeof res.body[0].subject_name).toBe('string');
    });

    it('returns [] while the period switch is off', async () => {
      await seedPeriodRoutine(dataSource, {
        tenantId: TENANT_ID,
        academicYearId: SEED_ACADEMIC_YEAR_ID,
        sectionId: MAPPED_SECTION_ID,
        date: PDATE,
        periods: 2,
        createdBy: SEED_ADMIN_USER_ID,
      });
      await setPeriodSwitch(false);
      const res = await getPeriods(adminToken, UserRole.ADMIN).expect(200);
      expect(res.body).toEqual([]);
    });

    it('403s a TEACHER who is neither mapped to the section nor its substitute', async () => {
      await setPeriodSwitch(true);
      await supertest(app.getHttpServer())
        .get(`/api/v1/attendance/sections/${UNMAPPED_SECTION_ID}/periods`)
        .query({ date: PDATE })
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(403);
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

    it("returns 403 for a role not in this route's @Roles list (STUDENT)", async () => {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );
      const loginRes = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);

      await supertest(app.getHttpServer())
        .get(`/api/v1/attendance/sections/${MAPPED_SECTION_ID}/register`)
        .query({ date: todayIso() })
        .set('Authorization', `Bearer ${loginRes.body.access_token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
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

    it('returns 403 for a role lacking ATTENDANCE_MARK (ACCOUNTANT)', async () => {
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
        .expect(403);
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
    it('returns 403 for a role lacking ATTENDANCE_MARK (ACCOUNTANT)', async () => {
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
        .patch(`/api/v1/attendance/records/${recordId}`)
        .set('Authorization', `Bearer ${loginRes.body.access_token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .send({ status: 'LATE', minutes_late: 10, reason: 'Arrived late today' })
        .expect(403);
    });

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
