import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { ResultsService } from './results.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { ExamKind, ExamStatus, UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_CLASS_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_USER_ID,
} from '@test/constants';

/**
 * [19.9.1] `GET /students/:studentId/results` and
 * `GET /students/:studentId/results/:examId` — the portal's PUBLISHED-only
 * gate and the staff panel's "everything, unpublished included" behaviour.
 *
 * Identity-scoping (unlinked/cross-tenant PARENT) already gets full
 * coverage for free via `STUDENT_SCOPED_ROUTES` in
 * `family-read-api.e2e-spec.ts` — this file only covers the one thing that
 * table can't: the publish/unpublish gate (D19).
 */
const API = '/api/v1';

describe('[19.9.1] Student results (portal + staff)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let http: () => supertest.SuperTest<supertest.Test>;

  const TENANT_ID = SEED_TENANT_ID;
  const PARENT_USER_ID = '00000000-0000-4000-8000-0000005c0001';
  const PARENT_EMAIL = 'student-results-parent@e2e.example';

  let studentId: string;
  let scaleId: string;
  let publishedExamId: string;
  let unpublishedExamId: string;
  let adminToken: string;
  let parentToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);
    http = () => supertest(app.getHttpServer()) as unknown as supertest.SuperTest<supertest.Test>;

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Results Parent', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, TENANT_ID, UserRole.PARENT],
    );

    const login = async (email: string): Promise<string> => {
      const res = await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token;
    };
    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  async function seedResultFixture(): Promise<void> {
    const studentRows = await dataSource.query(
      `INSERT INTO students
         (full_name, registration_number, roll_number, class_section_id, tenant_id,
          enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'SMS', NOW(), NOW())
       RETURNING id`,
      [
        'Results Student',
        `SR-${Math.random().toString(36).slice(2, 12)}`,
        Math.floor(Math.random() * 1000000),
        SEED_SECTION_1_ID,
        TENANT_ID,
      ],
    );
    studentId = studentRows[0].id;

    const guardianRows = await dataSource.query(
      `INSERT INTO guardians (user_id, full_name, relationship, tenant_id, created_at, updated_at)
       VALUES ($1, 'Results Parent', 'PARENT', $2, NOW(), NOW()) RETURNING id`,
      [PARENT_USER_ID, TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [studentId, guardianRows[0].id],
    );

    const scaleRows = await dataSource.query(
      `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ('NCTB', 1, $1, $2, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, TENANT_ID],
    );
    scaleId = scaleRows[0].id;
    await dataSource.query(
      `INSERT INTO grading_bands
         (scale_id, percent_from, percent_to, grade, gpa, is_fail, sequence, tenant_id, created_at, updated_at)
       VALUES ($1, 80, 100, 'A+', 5.00, false, 1, $2, NOW(), NOW())`,
      [scaleId, TENANT_ID],
    );

    const publishedExam = await dataSource.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, published_at, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Published Term Exam', $3, $4, NOW(), $5, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.TERM, ExamStatus.PUBLISHED, TENANT_ID],
    );
    publishedExamId = publishedExam[0].id;

    const unpublishedExam = await dataSource.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Unpublished Monthly Test', $3, $4, $5, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.MONTHLY, ExamStatus.PROCESSED, TENANT_ID],
    );
    unpublishedExamId = unpublishedExam[0].id;

    const subjectRows = await dataSource.query(
      `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
       VALUES ('Mathematics', $1, $2, NOW(), NOW()) RETURNING id`,
      [`SR-MATH-${Math.random().toString(36).slice(2, 8)}`, TENANT_ID],
    );
    const subjectId = subjectRows[0].id;

    const makeResult = async (examId: string, published: boolean) => {
      const resultRows = await dataSource.query(
        `INSERT INTO results
           (exam_id, student_id, total_marks, gpa, grade, position, is_fail,
            grading_scale_id, grading_scale_revision, rule_version, computed_at, published_at,
            tenant_id, created_at, updated_at)
         VALUES ($1, $2, 90.00, 5.00, 'A+', 1, false, $3, 1, 'nctb-v1', NOW(), $4, $5, NOW(), NOW())
         RETURNING id`,
        [examId, studentId, scaleId, published ? new Date() : null, TENANT_ID],
      );
      await dataSource.query(
        `INSERT INTO result_subjects
           (result_id, subject_id, obtained, grade, gpa, is_fail, is_fourth_subject, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 90.00, 'A+', 5.00, false, false, $3, NOW(), NOW())`,
        [resultRows[0].id, subjectId, TENANT_ID],
      );
    };
    await makeResult(publishedExamId, true);
    await makeResult(unpublishedExamId, false);
  }

  describe('GET /students/:studentId/results', () => {
    it('a PARENT sees only the published exam — the unpublished one is absent, not flagged', async () => {
      await seedResultFixture();

      const res = await http()
        .get(`${API}/students/${studentId}/results`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ exam_id: publishedExamId, published: true });
      expect(res.body.some((r: { exam_id: string }) => r.exam_id === unpublishedExamId)).toBe(
        false,
      );
    });

    it('staff (ADMIN) sees both exams, the unpublished one labelled published: false', async () => {
      await seedResultFixture();

      const res = await http()
        .get(`${API}/students/${studentId}/results`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body).toHaveLength(2);
      const byId = Object.fromEntries(
        res.body.map((r: { exam_id: string; published: boolean }) => [r.exam_id, r.published]),
      );
      expect(byId[publishedExamId]).toBe(true);
      expect(byId[unpublishedExamId]).toBe(false);
    });
  });

  describe('GET /students/:studentId/results/:examId', () => {
    it('a PARENT can fetch the report card for the published exam', async () => {
      await seedResultFixture();

      const res = await http()
        .get(`${API}/students/${studentId}/results/${publishedExamId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.exam_name).toBe('Published Term Exam');
      expect(Array.isArray(res.body.legend)).toBe(true);
      expect(res.body.legend.length).toBeGreaterThan(0);
    });

    it('a PARENT gets 404 for the unpublished exam — never a result', async () => {
      await seedResultFixture();

      await http()
        .get(`${API}/students/${studentId}/results/${unpublishedExamId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });

    it('staff (ADMIN) can fetch the unpublished exam’s report card too', async () => {
      await seedResultFixture();

      const res = await http()
        .get(`${API}/students/${studentId}/results/${unpublishedExamId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.exam_name).toBe('Unpublished Monthly Test');
    });
  });

  describe('[68.1.07] a student who left keeps the result after reopen + reprocess + re-publish', () => {
    it('the PARENT still reads the published report card', async () => {
      await seedResultFixture();
      // The student left (TRANSFERRED) after the exam was published.
      await dataSource.query(
        `INSERT INTO enrollments
           (student_id, class_id, section_id, academic_year_id, enrollment_status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'TRANSFERRED', $5, NOW(), NOW())`,
        [studentId, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID, TENANT_ID],
      );
      const [{ subject_id }] = await dataSource.query(
        `SELECT subject_id FROM result_subjects WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [TENANT_ID],
      );
      await dataSource.query(
        `INSERT INTO class_subjects (class_id, subject_id, academic_year_id, is_optional, is_graded_only, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, false, false, $4, NOW(), NOW())`,
        [SEED_CLASS_1_ID, subject_id, SEED_ACADEMIC_YEAR_ID, TENANT_ID],
      );

      // The mark the published 90 / A+ came from — "who sat it" needs a Mark.
      const [component] = await dataSource.query(
        `INSERT INTO exam_components (tenant_id, exam_id, subject_id, name, kind, source, full_marks, sequence, created_at, updated_at)
         VALUES ($1, $2, $3, 'Written', 'WRITTEN', 'MANUAL', 100, 1, NOW(), NOW()) RETURNING id`,
        [TENANT_ID, publishedExamId, subject_id],
      );
      await dataSource.query(
        `INSERT INTO marks (tenant_id, exam_id, student_id, subject_id, component_id, value, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, 90, 'PRESENT', NOW())`,
        [TENANT_ID, publishedExamId, studentId, subject_id, component.id],
      );

      const results = app.get(ResultsService);
      await results.reopen(publishedExamId, TENANT_ID, SEED_ADMIN_USER_ID);
      await results.process(publishedExamId, TENANT_ID, SEED_ADMIN_USER_ID, true);
      await results.publish(publishedExamId, TENANT_ID, SEED_ADMIN_USER_ID);

      const res = await http()
        .get(`${API}/students/${studentId}/results/${publishedExamId}`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
      expect(res.body.exam_name).toBe('Published Term Exam');
      // Same totals as before the reprocess, recomputed from the real mark.
      expect(res.body.result).toMatchObject({ total_marks: 90, grade: 'A+', position: 1 });
    });
  });

  describe('tenant isolation', () => {
    const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000005c0099';
    const OTHER_ADMIN_ID = '00000000-0000-4000-8000-0000005c0002';
    const OTHER_ADMIN_EMAIL = 'student-results-other-admin@e2e.example';

    it('a tenant B admin reading a tenant A student’s result gets 404', async () => {
      await seedResultFixture();
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'Results Other School', 'results-other-school', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [OTHER_TENANT_ID],
      );
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Other Admin', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_ADMIN_ID, OTHER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
      );
      // ADMIN in tenant B only — no membership in tenant A.
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_ADMIN_ID, OTHER_TENANT_ID, UserRole.ADMIN],
      );
      const login = await http()
        .post(`${API}/auth/login`)
        .send({ email: OTHER_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);

      await http()
        .get(`${API}/students/${studentId}/results/${publishedExamId}`)
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(404);
    });
  });

  describe('[68.3.01] TEACHER section scope', () => {
    // The seed admin user doubles as the teacher (TEACHER membership + a `teachers` row), selected
    // with X-Role. `teachers`/`teacher_class_sections`/`subjects` are truncated per test, so the
    // fixture is re-created in beforeEach.
    let scopeToken: string;
    beforeEach(async () => {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
      );
      const teacher = await dataSource.getRepository(Teacher).save({
        user_id: SEED_ADMIN_USER_ID,
        employee_id: `EMP-SCOPE-${Math.random().toString(36).slice(2, 8)}`,
        tenant_id: TENANT_ID,
        designations: [],
      });
      const [subject] = await dataSource.query(
        `INSERT INTO subjects (name_en, code, tenant_id, created_at, updated_at)
         VALUES ('Scope Maths', $1, $2, NOW(), NOW()) RETURNING id`,
        [`SC-${Math.random().toString(36).slice(2, 8)}`, TENANT_ID],
      );
      // Teaches SEED_SECTION_1 only; SEED_SECTION_2 plays the "other class".
      await dataSource.query(
        `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, subject_id, assignment_type)
         VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER')`,
        [teacher.id, SEED_SECTION_1_ID, TENANT_ID, subject.id],
      );
      // The JWT embeds the user's memberships, so log in AFTER adding TEACHER.
      const login = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      scopeToken = login.body.access_token;
    });

    const asTeacher = (r: supertest.Test) =>
      r
        .set('Authorization', `Bearer ${scopeToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER);
    const asAdmin = (r: supertest.Test) =>
      r
        .set('Authorization', `Bearer ${scopeToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN);
    const get = (path: string) => http().get(`${API}${path}`);
    const insertStudent = async (name: string, sectionId: string) => {
      const [row] = await dataSource.query(
        `INSERT INTO students
           (full_name, registration_number, roll_number, class_section_id, tenant_id,
            enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          name,
          `SC-${Math.random().toString(36).slice(2, 12)}`,
          Math.floor(Math.random() * 1000000),
          sectionId,
          TENANT_ID,
        ],
      );
      return row.id as string;
    };

    // The fixture student sits in section 1 (taught); a second student sits in section 2.
    const addOtherStudentResult = async () => {
      const otherStudent = await insertStudent('Scope Other', SEED_SECTION_2_ID);
      await dataSource.query(
        `INSERT INTO results
           (exam_id, student_id, total_marks, gpa, grade, position, is_fail,
            grading_scale_id, grading_scale_revision, rule_version, computed_at,
            section_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 70.00, 4.00, 'A', 2, false, $3, 1, 'nctb-v1', NOW(), $4, $5, NOW(), NOW())`,
        [unpublishedExamId, otherStudent, scaleId, SEED_SECTION_2_ID, TENANT_ID],
      );
      return otherStudent;
    };

    it('TEACHER GET /exams/:id/results returns only own-section rows', async () => {
      await seedResultFixture();
      await dataSource.query(`UPDATE results SET section_id = $1 WHERE student_id = $2`, [
        SEED_SECTION_1_ID,
        studentId,
      ]);
      const otherStudent = await addOtherStudentResult();

      const teacher = await asTeacher(get(`/exams/${unpublishedExamId}/results`)).expect(200);
      expect(teacher.body.map((r: { student_id: string }) => r.student_id)).toEqual([studentId]);

      const admin = await asAdmin(get(`/exams/${unpublishedExamId}/results`)).expect(200);
      expect(admin.body.map((r: { student_id: string }) => r.student_id)).toEqual(
        expect.arrayContaining([studentId, otherStudent]),
      );
    });

    it('TEACHER gets 404 (D13) on /exams/:id/results/:studentId for another section, 200 for own', async () => {
      await seedResultFixture();
      const otherStudent = await addOtherStudentResult();
      await asTeacher(get(`/exams/${unpublishedExamId}/results/${otherStudent}`)).expect(404);
      await asTeacher(get(`/exams/${unpublishedExamId}/results/${studentId}`)).expect(200);
    });

    it('TEACHER gets 404 on /students/:id/results and /results/:examId for another section', async () => {
      await seedResultFixture();
      const otherStudent = await addOtherStudentResult();
      await asTeacher(get(`/students/${otherStudent}/results`)).expect(404);
      await asTeacher(get(`/students/${otherStudent}/results/${unpublishedExamId}`)).expect(404);
      await asTeacher(get(`/students/${studentId}/results`)).expect(200);
      await asTeacher(get(`/students/${studentId}/results/${unpublishedExamId}`)).expect(200);
    });

    it('PARENT: linked child still 200, unlinked still rejected (401, as before)', async () => {
      await seedResultFixture();
      const unlinked = await insertStudent('Scope Unlinked', SEED_SECTION_1_ID);
      await get(`/students/${studentId}/results`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
      await get(`/students/${unlinked}/results`)
        .set('Authorization', `Bearer ${parentToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(401);
    });
  });
});
