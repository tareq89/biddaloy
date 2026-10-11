import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { ExamKind, ExamStatus, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [68.0 ACAD-04 / X-06] `POST /exams/:examId/marks/submit` refuses blank
 * cells; `POST /exams/:examId/results/process` refuses a submitted sheet
 * that holds one. Scaffolding cloned from `analysis.e2e-spec.ts`.
 */
const API = '/api/v1';
const TENANT_B = '00000000-0000-4000-8000-0000068b0b01';

describe('[68.0] Marks submit rejects blank cells', () => {
  let app: INestApplication;
  let ds: DataSource;
  let http: () => supertest.SuperTest<supertest.Test>;
  let adminToken: string;
  let teacherToken: string;
  let tenantBTeacherToken: string;
  let examId: string;
  let subjectId: string;
  let componentId: string;
  let studentId: string;

  const addUser = async (id: string, email: string, role: UserRole, tenant: string) => {
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Marks Submit User', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, tenant, role],
    );
  };
  const login = async (email: string) =>
    (
      await http()
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
  const as = (token: string, role: UserRole, req: supertest.Test, tenant = SEED_TENANT_ID) =>
    req.set('Authorization', `Bearer ${token}`).set('X-Tenant-ID', tenant).set('X-Role', role);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    http = () => supertest(app.getHttpServer()) as unknown as supertest.SuperTest<supertest.Test>;

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Marks Submit Other School', 'marks-submit-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await addUser(
      '00000000-0000-4000-8000-0000068a0001',
      'ms-teacher@e2e.example',
      UserRole.TEACHER,
      SEED_TENANT_ID,
    );
    await addUser(
      '00000000-0000-4000-8000-0000068a0002',
      'ms-teacher-b@e2e.example',
      UserRole.TEACHER,
      TENANT_B,
    );
    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login('ms-teacher@e2e.example');
    tenantBTeacherToken = await login('ms-teacher-b@e2e.example');
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  /** The global beforeEach truncates exams/students/marks: seed per test. */
  async function seed(): Promise<void> {
    examId = (
      await ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Submit Exam', $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.TERM, ExamStatus.DRAFT, SEED_TENANT_ID],
      )
    )[0].id;
    subjectId = (
      await ds.query(
        `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
         VALUES ('Submit Math', 'MS-1', $1, NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID],
      )
    )[0].id;
    componentId = (
      await ds.query(
        `INSERT INTO exam_components (exam_id, subject_id, name, kind, source, full_marks, sequence, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Written', 'WRITTEN', 'MANUAL', 100, 1, $3, NOW(), NOW()) RETURNING id`,
        [examId, subjectId, SEED_TENANT_ID],
      )
    )[0].id;
    studentId = (
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
            enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('Submit Student', 'MS-REG-1', 1, $1, $2, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [SEED_SECTION_1_ID, SEED_TENANT_ID],
      )
    )[0].id;
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', $5, NOW(), NOW())`,
      [studentId, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
  }

  const submit = (token = adminToken, role = UserRole.ADMIN, tenant = SEED_TENANT_ID) =>
    as(
      token,
      role,
      http()
        .post(`${API}/exams/${examId}/marks/submit`)
        .send({ section_id: SEED_SECTION_1_ID, subject_id: subjectId }),
      tenant,
    );

  it('409 GRID_INCOMPLETE while a cell is blank', async () => {
    await seed();
    const res = await submit().expect(409);
    expect(res.body.details.code).toBe('GRID_INCOMPLETE');
    expect(res.body.details.blank_count).toBe(1);
  });

  it('2xx once the cell holds a mark', async () => {
    await seed();
    await ds.query(
      `INSERT INTO marks (exam_id, subject_id, component_id, student_id, status, value, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ABSENT', NULL, $5, NOW(), NOW())`,
      [examId, subjectId, componentId, studentId, SEED_TENANT_ID],
    );
    await submit().expect((r) => expect(r.status).toBeLessThan(300));
  });

  it('403 for a teacher who is not this section-subject’s teacher', async () => {
    await seed();
    await submit(teacherToken, UserRole.TEACHER).expect(403);
  });

  it('404 for another tenant’s teacher on this tenant’s exam', async () => {
    await seed();
    await submit(tenantBTeacherToken, UserRole.TEACHER, TENANT_B).expect(404);
  });

  it('process (no force) 409 when a submitted sheet has a blank cell', async () => {
    await seed();
    // a sheet submitted while complete, then a rostered student gains a blank (X-06)
    await ds.query(
      `INSERT INTO mark_grids (exam_id, section_id, subject_id, state, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, 'SUBMITTED', $4, NOW(), NOW())`,
      [examId, SEED_SECTION_1_ID, subjectId, SEED_TENANT_ID],
    );
    await as(
      adminToken,
      UserRole.ADMIN,
      http().post(`${API}/exams/${examId}/results/process`).send({}),
    ).expect(409);
  });
});
