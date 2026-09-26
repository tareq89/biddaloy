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
} from '@test/constants';

const API = '/api/v1';

const PARENT_USER_ID = '00000000-0000-4000-8000-0000106b0001';
const OTHER_PARENT_USER_ID = '00000000-0000-4000-8000-0000106b0002';
const PARENT_EMAIL = 'programs-parent@e2e.example';
const OTHER_PARENT_EMAIL = 'programs-other-parent@e2e.example';

/**
 * E2E for [34.2.1]'s enrolment/achievement routes: the TEACHER
 * MANAGE-vs-RECORD permission split, the D24 portal-scoping guard chain on
 * `GET /students/:studentId/programs` (own child only), and tenant
 * isolation.
 */
describe('Program Enrollments E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let parentToken: string;
  let otherParentToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = randomUUID();
  const SECTION_ID = SEED_SECTION_1_ID;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
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

    // A second tenant + admin membership, to prove tenant isolation.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Program School', $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID, `other-program-school-${OTHER_TENANT_ID.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    // Same admin user also holds TEACHER in the main tenant, so the
    // X-Role header switch (same pattern as programs.controller.e2e-spec.ts)
    // can exercise the MANAGE-vs-RECORD split without a second login.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Programs Parent', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Programs Other Parent', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_PARENT_USER_ID, OTHER_PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, TENANT_ID, UserRole.PARENT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_PARENT_USER_ID, TENANT_ID, UserRole.PARENT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
    otherParentToken = await login(OTHER_PARENT_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  function req(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    token: string,
    tenantId: string,
    role?: UserRole,
  ) {
    const r = supertest(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId);
    return role ? r.set('X-Role', role) : r;
  }

  async function createStudentWithParent(parentUserId: string) {
    const studentRes = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
       VALUES ($1, 'Programs Student', $2, 1, $3, $4, 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [randomUUID(), `PROGRAMS-E2E-REG-${randomUUID().slice(0, 8)}`, SECTION_ID, TENANT_ID],
    );
    const studentId = studentRes[0].id;

    const guardianRes = await dataSource.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('Programs Guardian', 'FATHER', '+8801700000002', $1, $2, $3, 'SMS', true, NOW(), NOW())
       RETURNING id`,
      [`programs-guardian-${randomUUID().slice(0, 8)}@e2e.example`, TENANT_ID, parentUserId],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [studentId, guardianRes[0].id],
    );

    return studentId;
  }

  async function createProgramWithMilestone() {
    const programRes = await req('post', `${API}/programs`, adminToken, TENANT_ID, UserRole.ADMIN)
      .send({ name: `E2E Program ${randomUUID().slice(0, 8)}` })
      .expect(201);
    const programId = programRes.body.id as string;

    const milestoneRes = await req(
      'post',
      `${API}/programs/${programId}/milestones`,
      adminToken,
      TENANT_ID,
      UserRole.ADMIN,
    )
      .send({ name: 'Juz 1' })
      .expect(201);

    return { programId, milestoneId: milestoneRes.body.id as string };
  }

  describe('MANAGE vs RECORD permission split', () => {
    it('TEACHER can POST achievements but not enrolments', async () => {
      const { programId, milestoneId } = await createProgramWithMilestone();
      const studentId = await createStudentWithParent(PARENT_USER_ID);

      await req(
        'post',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      )
        .send({ student_ids: [studentId] })
        .expect(201);

      const enrollmentsRes = await req(
        'get',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      ).expect(200);
      const enrollmentId = enrollmentsRes.body[0].id as string;

      // TEACHER (same admin user, X-Role switch) holds PROGRAM_RECORD but
      // not PROGRAM_MANAGE.
      await req(
        'post',
        `${API}/programs/${programId}/achievements`,
        adminToken,
        TENANT_ID,
        UserRole.TEACHER,
      )
        .send({ enrollment_ids: [enrollmentId], milestone_id: milestoneId })
        .expect(201);

      await req(
        'post',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        TENANT_ID,
        UserRole.TEACHER,
      )
        .send({ student_ids: [studentId] })
        .expect(401);
    });
  });

  describe('D24 portal scoping: GET /students/:studentId/programs', () => {
    it("PARENT sees own linked child's programs", async () => {
      const { programId } = await createProgramWithMilestone();
      const studentId = await createStudentWithParent(PARENT_USER_ID);
      await req(
        'post',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      )
        .send({ student_ids: [studentId] })
        .expect(201);

      const res = await req(
        'get',
        `${API}/students/${studentId}/programs`,
        parentToken,
        TENANT_ID,
      ).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].program.id).toBe(programId);
    });

    it("PARENT gets 401/403 for another family's child", async () => {
      const studentId = await createStudentWithParent(OTHER_PARENT_USER_ID);
      await req('get', `${API}/students/${studentId}/programs`, parentToken, TENANT_ID).expect(401);
    });

    it("PARENT of tenant A can't reach a student via a spoofed tenant header", async () => {
      const studentId = await createStudentWithParent(PARENT_USER_ID);
      await req('get', `${API}/students/${studentId}/programs`, otherParentToken, TENANT_ID).expect(
        401,
      );
    });
  });

  describe('PATCH /program-enrollments/:id', () => {
    it('transitions status at the correct (non-nested) URL', async () => {
      const { programId } = await createProgramWithMilestone();
      const studentId = await createStudentWithParent(PARENT_USER_ID);
      await req(
        'post',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      )
        .send({ student_ids: [studentId] })
        .expect(201);
      const enrollmentsRes = await req(
        'get',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      ).expect(200);
      const enrollmentId = enrollmentsRes.body[0].id as string;

      const res = await req(
        'patch',
        `${API}/program-enrollments/${enrollmentId}`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      )
        .send({ status: 'WITHDRAWN' })
        .expect(200);

      expect(res.body.id).toBe(enrollmentId);
      expect(res.body.status).toBe('WITHDRAWN');
    });
  });

  describe('DELETE /milestone-achievements/:id', () => {
    it('removes a recorded achievement', async () => {
      const { programId, milestoneId } = await createProgramWithMilestone();
      const studentId = await createStudentWithParent(PARENT_USER_ID);
      await req(
        'post',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      )
        .send({ student_ids: [studentId] })
        .expect(201);
      const enrollmentsRes = await req(
        'get',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      ).expect(200);
      const enrollmentId = enrollmentsRes.body[0].id as string;
      await req(
        'post',
        `${API}/programs/${programId}/achievements`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      )
        .send({ enrollment_ids: [enrollmentId], milestone_id: milestoneId })
        .expect(201);
      const achievementId = (
        await dataSource.query(
          `SELECT id FROM milestone_achievements WHERE enrollment_id = $1 AND milestone_id = $2`,
          [enrollmentId, milestoneId],
        )
      )[0].id as string;

      await req(
        'delete',
        `${API}/milestone-achievements/${achievementId}`,
        adminToken,
        TENANT_ID,
        UserRole.ADMIN,
      ).expect(200);

      const rows = await dataSource.query(`SELECT id FROM milestone_achievements WHERE id = $1`, [
        achievementId,
      ]);
      expect(rows).toHaveLength(0);
    });
  });

  describe('tenant isolation', () => {
    it('ADMIN of tenant B cannot see tenant A programs/enrollments', async () => {
      const { programId } = await createProgramWithMilestone();
      await req(
        'get',
        `${API}/programs/${programId}/enrollments`,
        adminToken,
        OTHER_TENANT_ID,
        UserRole.ADMIN,
      ).expect(404);
    });
  });
});
