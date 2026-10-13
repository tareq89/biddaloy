import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { assignTeacherToSection } from '@test/helpers/teacher-scope.fixture';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_CLASS_2_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
} from '@test/constants';

/**
 * E2E tests for GET /enrollments/:studentId/current — [8.11.3].
 *
 * `enrollments.controller.spec.ts` only exercises `EnrollmentController`
 * directly, bypassing `AuthGuard`/`ContextGuard`/`RolesGuard` entirely.
 * These tests go through the real HTTP stack so the guard chain itself
 * (role allowlist, tenant header, tenant membership) is covered too.
 */
describe('Enrollments E2E — GET /enrollments/:studentId/current', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let studentId: string;

  const TENANT_ID = SEED_TENANT_ID;
  // A real, seeded tenant the admin user has no membership in.
  const FOREIGN_TENANT_ID = '00000000-0000-4000-8000-000000000099';

  async function createStudent(): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [
        'Enrollment E2E Student',
        `REG-ENR-E2E-${Date.now()}`,
        1,
        SEED_SECTION_1_ID,
        TENANT_ID,
        '2010-01-01',
        'SMS',
        'ACTIVE',
      ],
    );
    return res[0].id;
  }

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

    // The seed already makes SEED_ADMIN_USER_ID an ADMIN of SEED_TENANT_ID.
    // Add the endpoint's other allowed roles, plus one denied role, as
    // additional memberships in the same tenant — the JWT then carries all
    // of them and X-Role picks which one a given request uses.
    for (const role of [
      UserRole.ACCOUNTANT,
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.STUDENT,
      UserRole.OFFICE_STAFF,
    ]) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, role],
      );
    }

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    // user_tenants is excluded from clearTransactionalTables (it holds the
    // seeded admin's baseline membership), so the extra roles added above
    // must be cleaned up here to avoid leaking into later e2e suites.
    await dataSource.query(
      `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`,
      [
        SEED_ADMIN_USER_ID,
        TENANT_ID,
        [
          UserRole.ACCOUNTANT,
          UserRole.EXECUTIVE,
          UserRole.TEACHER,
          UserRole.STUDENT,
          UserRole.OFFICE_STAFF,
        ],
      ],
    );
    await app.close();
  });

  // The global test setup truncates `students` before every test — create
  // a fresh one each time rather than once in `beforeAll`.
  beforeEach(async () => {
    studentId = await createStudent();
  });

  it.each([UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.EXECUTIVE, UserRole.TEACHER])(
    'returns 200 for %s role',
    async (role) => {
      // 75.6: a TEACHER reads only the sections they teach.
      if (role === UserRole.TEACHER) {
        await assignTeacherToSection(dataSource, SEED_ADMIN_USER_ID, SEED_SECTION_1_ID);
      }
      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/enrollments/${studentId}/current`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', role)
        .expect(200);

      // No enrollment row was created for this student — a legacy
      // student, per EnrollmentService.findCurrentByStudent's contract.
      expect(res.body).toBeNull();
    },
  );

  it("returns 403 for STUDENT, a role not in the endpoint's allowlist", async () => {
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/enrollments/${studentId}/current`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .expect(403);

    expect(res.body.message).toContain('Requires one of roles');
  });

  it('returns 401 when X-Tenant-ID is missing', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/enrollments/${studentId}/current`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(res.body.message).toBe('X-Tenant-ID header is required');
  });

  it('returns 401 when X-Tenant-ID names a tenant the user is not a member of', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/enrollments/${studentId}/current`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', FOREIGN_TENANT_ID)
      .expect(401);

    expect(res.body.message).toContain('is not a member of tenant');
  });
  // [68.3.17.1] LIFE-07 — class change / second enrollment needs PROMOTION_MANAGE.
  describe('class-change gate', () => {
    const api = (method: 'post' | 'patch', url: string, role: UserRole) =>
      supertest(app.getHttpServer())
        [method](`/api/v1/enrollments${url}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', role);

    async function enroll(): Promise<string> {
      const res = await api('post', '', UserRole.ADMIN)
        .send({
          student_id: studentId,
          class_id: SEED_CLASS_1_ID,
          section_id: SEED_SECTION_1_ID,
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
        })
        .expect(201);
      return res.body.id;
    }

    it.each([UserRole.ACCOUNTANT, UserRole.OFFICE_STAFF])(
      '%s POST /enrollments for an already-enrolled student -> 403',
      async (role) => {
        await enroll();
        const res = await api('post', '', role)
          .send({
            student_id: studentId,
            class_id: SEED_CLASS_2_ID,
            section_id: SEED_SECTION_2_ID,
            academic_year_id: SEED_ACADEMIC_YEAR_ID,
          })
          .expect(403);
        expect(res.body.details.code).toBe('ENROLLMENT_CLASS_CHANGE_NEEDS_PROMOTION');
      },
    );

    it.each([UserRole.ACCOUNTANT, UserRole.OFFICE_STAFF])(
      '%s PATCH with a new class_id -> 403',
      async (role) => {
        const id = await enroll();
        await api('patch', `/${id}`, role)
          .send({ class_id: SEED_CLASS_2_ID, section_id: SEED_SECTION_2_ID })
          .expect(403);
      },
    );

    it('ACCOUNTANT section-only PATCH -> 200', async () => {
      const id = await enroll();
      await api('patch', `/${id}`, UserRole.ACCOUNTANT)
        .send({ section_id: SEED_SECTION_1_ID })
        .expect(200);
    });

    it('ADMIN class change -> 200', async () => {
      const id = await enroll();
      await api('patch', `/${id}`, UserRole.ADMIN)
        .send({ class_id: SEED_CLASS_2_ID, section_id: SEED_SECTION_2_ID })
        .expect(200);
    });

    it('an enrollment id from another tenant -> 404', async () => {
      await api('patch', '/00000000-0000-4000-8000-0000000000aa', UserRole.ADMIN)
        .send({ section_id: SEED_SECTION_1_ID })
        .expect(404);
    });
  });
});
