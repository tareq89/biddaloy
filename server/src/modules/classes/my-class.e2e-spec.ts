import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TeacherAssignmentType, TeacherDesignation, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E for `GET /my-class/sections` [47.2.3]. The seed admin user doubles as
 * the teacher: it gets a TEACHER membership plus a `teachers` row, so the JWT
 * user id maps to `teacher_class_sections` the way a real teacher's does.
 */
describe('My Class E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherId: string;
  let membershipId: string | undefined;
  const createdSectionIds: string[] = [];
  const createdClassIds: string[] = [];

  const OTHER_TENANT = '00000000-0000-4000-8000-000000000097';
  const get = (token: string, role: UserRole, tenantId = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .get('/api/v1/my-class/sections')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId)
      .set('X-Role', role);

  async function login() {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token as string;
  }

  async function makeSection(className: string, sectionName: string) {
    const [klass] = await dataSource.query(
      `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, $2, $3) RETURNING id`,
      [SEED_TENANT_ID, className, SEED_ACADEMIC_YEAR_ID],
    );
    const [section] = await dataSource.query(
      `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, $3) RETURNING id`,
      [SEED_TENANT_ID, klass.id, sectionName],
    );
    createdClassIds.push(klass.id);
    createdSectionIds.push(section.id);
    return section.id as string;
  }

  const assign = (sectionId: string, type: TeacherAssignmentType) =>
    dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type)
       VALUES ($1, $2, $3, $4)`,
      [teacherId, sectionId, SEED_TENANT_ID, type],
    );

  beforeAll(async () => {
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

    const inserted = await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`,
      [SEED_ADMIN_USER_ID, SEED_TENANT_ID, UserRole.TEACHER],
    );
    membershipId = inserted[0]?.id;
    // Make the seed year current so the sections below count as "this year".
    await dataSource.query(`UPDATE academic_years SET is_current = false WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource.query(`UPDATE academic_years SET is_current = true WHERE id = $1`, [
      SEED_ACADEMIC_YEAR_ID,
    ]);
    adminToken = await login();
  }, 60000);

  // `teachers` / `teacher_class_sections` are truncated before every test by
  // test/setup.ts, so the teacher is re-created each time.
  beforeEach(async () => {
    // Via the repository so the `staff_profile_id` subscriber/default runs.
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: SEED_ADMIN_USER_ID,
      employee_id: `EMP-MYC-${Math.random().toString(36).slice(2, 8)}`,
      tenant_id: SEED_TENANT_ID,
      designations: [TeacherDesignation.CLASS_TEACHER],
    });
    teacherId = teacher.id;
  });

  afterAll(async () => {
    if (createdSectionIds.length) {
      await dataSource.query(`DELETE FROM class_sections WHERE id = ANY($1)`, [createdSectionIds]);
      await dataSource.query(`DELETE FROM classes WHERE id = ANY($1)`, [createdClassIds]);
    }
    if (membershipId) {
      await dataSource.query(`DELETE FROM user_tenants WHERE id = $1`, [membershipId]);
    }
    await app.close();
  });

  it('gives a TEACHER with two homeroom sections both rows with their roles', async () => {
    const a = await makeSection('MyClass 6', 'A');
    const b = await makeSection('MyClass 7', 'B');
    await assign(a, TeacherAssignmentType.CLASS_TEACHER);
    await assign(b, TeacherAssignmentType.ASSISTANT_CLASS_TEACHER);

    const res = await get(adminToken, UserRole.TEACHER).expect(200);

    expect(res.body).toEqual([
      expect.objectContaining({
        section_id: a,
        section_name: 'A',
        class_name: 'MyClass 6',
        assignment_type: TeacherAssignmentType.CLASS_TEACHER,
      }),
      expect.objectContaining({
        section_id: b,
        class_name: 'MyClass 7',
        assignment_type: TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
      }),
    ]);
  });

  it('returns [] for a TEACHER with only subject rows', async () => {
    const [subject] = await dataSource.query(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'MyClass Subj', $2) RETURNING id`,
      [SEED_TENANT_ID, `MC${Math.random().toString(36).slice(2, 7)}`],
    );
    const section = await makeSection('MyClass 8', 'A');
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
       VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER')`,
      [teacherId, section, SEED_TENANT_ID, subject.id],
    );
    try {
      const res = await get(adminToken, UserRole.TEACHER).expect(200);
      expect(res.body).toEqual([]);
    } finally {
      await dataSource.query(`DELETE FROM teacher_class_sections WHERE teacher_id = $1`, [
        teacherId,
      ]);
      await dataSource.query(`DELETE FROM subjects WHERE id = $1`, [subject.id]);
    }
  });

  it('returns 403 for ADMIN, who does not hold MY_CLASS_VIEW', async () => {
    const res = await get(adminToken, UserRole.ADMIN).expect(403);
    expect(res.body.message).toContain('Requires permission(s)');
  });

  it("returns [] for the same user in another tenant — tenant A's homeroom never leaks", async () => {
    const a = await makeSection('MyClass 9', 'A');
    await assign(a, TeacherAssignmentType.CLASS_TEACHER);
    await dataSource.query(
      `INSERT INTO schools (id, name, slug) VALUES ($1, 'Other', 'other-myc') ON CONFLICT DO NOTHING`,
      [OTHER_TENANT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT, UserRole.TEACHER],
    );
    try {
      const token = await login();
      const res = await get(token, UserRole.TEACHER, OTHER_TENANT).expect(200);
      expect(res.body).toEqual([]);
    } finally {
      await dataSource.query(`DELETE FROM user_tenants WHERE tenant_id = $1`, [OTHER_TENANT]);
    }
  });

  it('returns 401 without a token', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/my-class/sections')
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });
});
