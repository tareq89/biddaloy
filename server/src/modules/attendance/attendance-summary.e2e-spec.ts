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
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
} from '@test/constants';

const API = '/api/v1';

const PARENT_USER_ID = '00000000-0000-4000-8000-0000094a0001';
const STRANGER_USER_ID = '00000000-0000-4000-8000-0000094a0002';
const PARENT_EMAIL = 'summary-parent@e2e.example';
const STRANGER_EMAIL = 'summary-stranger@e2e.example';

/**
 * E2E tests for [9.4]'s five read endpoints — allowed/denied per role, and
 * the object-level scoping `@Roles(...)` alone can't express: a PARENT
 * reaching only their own linked child (via `FamilyAccessService`, same
 * 401-on-purpose contract as `family-read-api.e2e-spec.ts`), and a TEACHER
 * reaching only a mapped section (via `AttendanceAccessService`, same
 * pattern as `attendance.e2e-spec.ts`).
 */
describe('Attendance Summary E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let teacherToken: string;
  let parentToken: string;
  let strangerToken: string;

  let studentId: string;

  const TENANT_ID = SEED_TENANT_ID;
  const MAPPED_SECTION_ID = SEED_SECTION_1_ID;
  const UNMAPPED_SECTION_ID = SEED_SECTION_2_ID;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-production';
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

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Summary Parent', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Summary Stranger', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [STRANGER_USER_ID, STRANGER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, TENANT_ID, UserRole.PARENT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [STRANGER_USER_ID, TENANT_ID, UserRole.PARENT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
    strangerToken = await login(STRANGER_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // `user_tenants` is a reference table; the seeded admin also acts as
    // TEACHER via X-Role, same pattern as `attendance.e2e-spec.ts`.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const teacherLoginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    // `teachers`/`teacher_class_sections`/`students`/`guardians` are
    // "transactional" tables — reseed every test.
    const teacherId = randomUUID();
    await dataSource.query(
      `INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'E2E-SUMMARY-TEACHER', '{}', $3, NOW(), NOW())`,
      [teacherId, SEED_ADMIN_USER_ID, TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), teacherId, MAPPED_SECTION_ID, TENANT_ID],
    );

    const studentRes = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
       VALUES ($1, 'Summary Student', 'SUMMARY-E2E-REG-1', 1, $2, $3, 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [randomUUID(), MAPPED_SECTION_ID, TENANT_ID],
    );
    studentId = studentRes[0].id;

    // Link the student to the PARENT (not the stranger) via student_guardians.
    const guardianRes = await dataSource.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('Summary Guardian', 'FATHER', '+8801700000000', 'summary-guardian@e2e.example',
               $1, $2, 'SMS', true, NOW(), NOW())
       RETURNING id`,
      [TENANT_ID, PARENT_USER_ID],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [studentId, guardianRes[0].id],
    );
  });

  describe('GET /attendance/students/:studentId/summary', () => {
    it('returns 200 for the PARENT linked to this child', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/attendance/students/${studentId}/summary`)
        .query({ from: '2026-09-01', to: '2026-09-05' })
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(200);
    });

    it("returns 401 for a PARENT not linked to this child (another family's child)", async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/attendance/students/${studentId}/summary`)
        .query({ from: '2026-09-01', to: '2026-09-05' })
        .set('Authorization', `Bearer ${strangerToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(401);
    });

    it('returns 200 for ADMIN regardless of family linkage', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/attendance/students/${studentId}/summary`)
        .query({ from: '2026-09-01', to: '2026-09-05' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
    });

    it('returns 400 when both month and from/to are supplied', async () => {
      const res = await supertest(app.getHttpServer())
        .get(`${API}/attendance/students/${studentId}/summary`)
        .query({ month: '2026-09', from: '2026-09-01', to: '2026-09-05' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(400);

      expect(res.body.message).toMatch(/month.*from.*to|from.*to.*month/i);
    });

    it('resolves ?month= into the first/last day of that month', async () => {
      const res = await supertest(app.getHttpServer())
        .get(`${API}/attendance/students/${studentId}/summary`)
        .query({ month: '2026-09' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.from).toBe('2026-09-01');
      expect(res.body.to).toBe('2026-09-30');
    });
  });

  describe('GET /attendance/sections/:sectionId/summary', () => {
    it('returns 200 for a TEACHER mapped to the section', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/attendance/sections/${MAPPED_SECTION_ID}/summary`)
        .query({ from: '2026-09-01', to: '2026-09-05' })
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);
    });

    it('returns 403 for a TEACHER not mapped to the section', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/attendance/sections/${UNMAPPED_SECTION_ID}/summary`)
        .query({ from: '2026-09-01', to: '2026-09-05' })
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(403);
    });
  });

  describe('GET /attendance/flags/low', () => {
    it('returns 200 for ADMIN', async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/attendance/flags/low`)
        .query({ from: '2026-09-01', to: '2026-09-05' })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
    });

    it("returns 401 for a role not in this route's @Roles list (TEACHER)", async () => {
      await supertest(app.getHttpServer())
        .get(`${API}/attendance/flags/low`)
        .query({ from: '2026-09-01', to: '2026-09-05' })
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(401);
    });
  });
});
