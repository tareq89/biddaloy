import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { ExamKind, ExamStatus, TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { Teacher } from '../academics/entities/teacher.entity';
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

  // D33/D13: a teacher miss is the same 404 as a section that does not exist.
  it('404 for a teacher who is not this section-subject’s teacher', async () => {
    await seed();
    const res = await submit(teacherToken, UserRole.TEACHER).expect(404);
    expect(res.body.message).toBe('Section not found');
  });

  it('404 for another tenant’s teacher on this tenant’s exam', async () => {
    await seed();
    await submit(tenantBTeacherToken, UserRole.TEACHER, TENANT_B).expect(404);
  });

  // D44: progress lists exactly the (section, subject) grids a teacher can open and save.
  describe('GET marks/progress for a teacher (D44)', () => {
    /** Math (`subjectId`) and English in section 1; the teacher gets `homeroom` and/or Math. */
    async function seedTeacher(opts: { homeroom: boolean; math: boolean }): Promise<string> {
      await seed();
      await ds.query(`UPDATE academic_years SET is_current = (id = $2) WHERE tenant_id = $1`, [
        SEED_TENANT_ID,
        SEED_ACADEMIC_YEAR_ID,
      ]);
      const [english] = await ds.query(
        `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
         VALUES ('Submit English', 'MS-2', $1, NOW(), NOW()) RETURNING id`,
        [SEED_TENANT_ID],
      );
      await ds.query(
        `INSERT INTO exam_components (exam_id, subject_id, name, kind, source, full_marks, sequence, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Written', 'WRITTEN', 'MANUAL', 100, 2, $3, NOW(), NOW())`,
        [examId, english.id, SEED_TENANT_ID],
      );
      const teacher = await ds.getRepository(Teacher).save({
        user_id: '00000000-0000-4000-8000-0000068a0001',
        employee_id: 'EMP-MS-1',
        tenant_id: SEED_TENANT_ID,
        designations: [],
      });
      const rows: [TeacherAssignmentType, string | null][] = [];
      if (opts.homeroom) rows.push([TeacherAssignmentType.CLASS_TEACHER, null]);
      if (opts.math) rows.push([TeacherAssignmentType.SUBJECT_TEACHER, subjectId]);
      for (const [type, subject] of rows) {
        await ds.query(
          `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
           VALUES ($1, $2, $3, $4, $5)`,
          [teacher.id, SEED_SECTION_1_ID, SEED_TENANT_ID, subject, type],
        );
      }
      return english.id as string;
    }
    const progress = async (token = teacherToken, role = UserRole.TEACHER) =>
      (await as(token, role, http().get(`${API}/exams/${examId}/marks/progress`)).expect(200))
        .body as { counts: { DRAFT: number }; outstanding: { subject_id: string }[] };

    it('a subject teacher sees only their own subject', async () => {
      const englishId = await seedTeacher({ homeroom: false, math: true });
      const body = await progress();
      expect(body.outstanding.map((o) => o.subject_id)).toEqual([subjectId]);
      expect(body.counts.DRAFT).toBe(1);
      // the admin still sees both grids
      const admin = await progress(adminToken, UserRole.ADMIN);
      expect(admin.outstanding.map((o) => o.subject_id).sort()).toEqual(
        [subjectId, englishId].sort(),
      );
    });

    it('a class teacher sees only the grids they can save: their own subject, not the homeroom read', async () => {
      await seedTeacher({ homeroom: true, math: true });
      const body = await progress();
      expect(body.outstanding.map((o) => o.subject_id)).toEqual([subjectId]);
      expect(body.counts.DRAFT).toBe(1);
    });

    it('a class teacher with no subject row sees an empty list', async () => {
      await seedTeacher({ homeroom: true, math: false });
      const body = await progress();
      expect(body.outstanding).toEqual([]);
      expect(body.counts.DRAFT).toBe(0);
    });
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
