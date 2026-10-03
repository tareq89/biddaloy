import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
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
  SEED_SECTION_2_ID,
  SEED_CLASS_1_ID,
  SEED_CLASS_2_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * [28.3.5] GET /performance/students/:id and /performance/classes/:id.
 * Covers the teacher scope, tenant isolation and the Analysis parity
 * acceptance criterion. Attendance values are not asserted: seeded data has
 * no attendance records and the denominator depends on school policy.
 */
const API = '/api/v1';
const TENANT_B = '00000000-0000-4000-8000-0000001f0001';
const TEACHER_USER_ID = '00000000-0000-4000-8000-0000001f0010';
const TEACHER_EMAIL = 'perf-teacher@e2e.example';
const ACCOUNTANT_USER_ID = '00000000-0000-4000-8000-0000001f0012';
const ACCOUNTANT_EMAIL = 'perf-accountant@e2e.example';
const OTHER_ADMIN_ID = '00000000-0000-4000-8000-0000001f0011';
const B_YEAR = '00000000-0000-4000-8000-0000001f0020';
const B_CLASS = '00000000-0000-4000-8000-0000001f0030';
const B_SECTION = '00000000-0000-4000-8000-0000001f0040';

describe('performance (28.3.5)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let accountantToken: string;
  let studentId: string;
  let otherTenantStudentId: string;
  let examId: string;

  const as = (req: supertest.Test, token: string, role: UserRole) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(id: string, email: string, tenantId: string, role: UserRole) {
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Perf E2E User', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [id, tenantId, role],
    );
  }

  async function insertStudent(tenantId: string, sectionId: string): Promise<string> {
    const r = await ds.query(
      `INSERT INTO students
         (full_name, registration_number, roll_number, class_section_id, tenant_id,
          enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ('Perf Student', $1, $2, $3, $4, 'ACTIVE', 'SMS', NOW(), NOW())
       RETURNING id`,
      [
        `PF-${Math.random().toString(36).slice(2, 12)}`,
        Math.floor(Math.random() * 1000000),
        sectionId,
        tenantId,
      ],
    );
    return r[0].id;
  }

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Perf Other School', 'perf-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await addUser(TEACHER_USER_ID, TEACHER_EMAIL, SEED_TENANT_ID, UserRole.TEACHER);
    await addUser(OTHER_ADMIN_ID, 'perf-other@e2e.example', TENANT_B, UserRole.ADMIN);
    await addUser(ACCOUNTANT_USER_ID, ACCOUNTANT_EMAIL, SEED_TENANT_ID, UserRole.ACCOUNTANT);
    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
    accountantToken = await login(ACCOUNTANT_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  // Transactional tables are wiped before every test, so reseed each time.
  beforeEach(async () => {
    const teacherId = randomUUID();
    // `teachers.staff_profile_id` is NOT NULL, hence the staff_profiles CTE.
    await ds.query(
      `WITH sp AS (
         INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES (gen_random_uuid(), $2::uuid, $3::uuid, 'EMP-PERF-' || $1, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
         RETURNING id
       )
       INSERT INTO teachers (id, user_id, employee_id, designations, tenant_id, staff_profile_id, created_at, updated_at)
       SELECT $1::uuid, $2::uuid, 'E2E-PERF-TEACHER', '{}', $3::uuid, sp.id, NOW(), NOW() FROM sp`,
      [teacherId, TEACHER_USER_ID, SEED_TENANT_ID],
    );
    // The teacher teaches section 1 of class 1 only.
    await ds.query(
      `INSERT INTO teacher_class_sections (id, teacher_id, section_id, tenant_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [randomUUID(), teacherId, SEED_SECTION_1_ID, SEED_TENANT_ID],
    );

    studentId = await insertStudent(SEED_TENANT_ID, SEED_SECTION_1_ID);
    await ds.query(
      `INSERT INTO enrollments (id, tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE')`,
      [SEED_TENANT_ID, studentId, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID],
    );

    // Other tenant's year/class/section/student, for the 404 cases.
    await ds.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'B-Year', '2026-01-01', '2026-12-31', true, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [B_YEAR, TENANT_B],
    );
    await ds.query(
      `INSERT INTO classes (id, name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B-Class', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [B_CLASS, B_YEAR, TENANT_B],
    );
    await ds.query(
      `INSERT INTO class_sections (id, section_name, class_id, tenant_id, created_at, updated_at)
       VALUES ($1, 'B-Sec', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [B_SECTION, B_CLASS, TENANT_B],
    );
    otherTenantStudentId = await insertStudent(TENANT_B, B_SECTION);

    // One PROCESSED exam on class 1 with one result row.
    const scale = await ds.query(
      `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ('NCTB', 1, $1, $2, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO grading_bands
         (scale_id, percent_from, percent_to, grade, gpa, is_fail, sequence, tenant_id, created_at, updated_at)
       VALUES ($1, 80, 100, 'A+', 5.00, false, 1, $2, NOW(), NOW())`,
      [scale[0].id, SEED_TENANT_ID],
    );
    const exam = await ds.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Perf Term Exam', $3, $4, $5, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.TERM, ExamStatus.PROCESSED, SEED_TENANT_ID],
    );
    examId = exam[0].id;
    await ds.query(
      `INSERT INTO results
         (exam_id, student_id, total_marks, gpa, grade, position, section_id, section_position,
          is_fail, grading_scale_id, grading_scale_revision, rule_version, computed_at, tenant_id,
          created_at, updated_at)
       VALUES ($1, $2, 90.00, 5.00, 'A+', 1, $3, 1, false, $4, 1, 'nctb-v1', NOW(), $5, NOW(), NOW())`,
      [examId, studentId, SEED_SECTION_1_ID, scale[0].id, SEED_TENANT_ID],
    );
  });

  const year = `academicYearId=${SEED_ACADEMIC_YEAR_ID}`;

  it('teacher of the class gets 200 on the class endpoint', async () => {
    await as(
      supertest(app.getHttpServer()).get(`${API}/performance/classes/${SEED_CLASS_1_ID}?${year}`),
      teacherToken,
      UserRole.TEACHER,
    ).expect(200);
  });

  it('teacher of the class gets 200 on the student endpoint', async () => {
    const res = await as(
      supertest(app.getHttpServer()).get(`${API}/performance/students/${studentId}?${year}`),
      teacherToken,
      UserRole.TEACHER,
    ).expect(200);
    expect(res.body.studentId).toBe(studentId);
    expect(res.body.noteRatingCount).toBe(0);
  });

  it('teacher gets 403 for a class they do not teach', async () => {
    await as(
      supertest(app.getHttpServer()).get(`${API}/performance/classes/${SEED_CLASS_2_ID}?${year}`),
      teacherToken,
      UserRole.TEACHER,
    ).expect(403);
  });

  it('section outside the class is 404 (lookup runs before scope check)', async () => {
    await as(
      supertest(app.getHttpServer()).get(
        `${API}/performance/classes/${SEED_CLASS_1_ID}?${year}&sectionId=${SEED_SECTION_2_ID}`,
      ),
      teacherToken,
      UserRole.TEACHER,
    ).expect(404);
  });

  it('role outside ADMIN/EXECUTIVE/TEACHER (ACCOUNTANT) is denied on both endpoints', async () => {
    await as(
      supertest(app.getHttpServer()).get(`${API}/performance/classes/${SEED_CLASS_1_ID}?${year}`),
      accountantToken,
      UserRole.ACCOUNTANT,
    ).expect(403); /* PermissionsGuard denial */
    await as(
      supertest(app.getHttpServer()).get(`${API}/performance/students/${studentId}?${year}`),
      accountantToken,
      UserRole.ACCOUNTANT,
    ).expect(403); /* PermissionsGuard denial */
  });

  it('ADMIN reads any class', async () => {
    await as(
      supertest(app.getHttpServer()).get(`${API}/performance/classes/${SEED_CLASS_2_ID}?${year}`),
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
  });

  it('cross-tenant class and student are 404 for ADMIN', async () => {
    await as(
      supertest(app.getHttpServer()).get(`${API}/performance/classes/${B_CLASS}?${year}`),
      adminToken,
      UserRole.ADMIN,
    ).expect(404);
    await as(
      supertest(app.getHttpServer()).get(
        `${API}/performance/students/${otherTenantStudentId}?${year}`,
      ),
      adminToken,
      UserRole.ADMIN,
    ).expect(404);
  });

  it('class numbers equal the Analysis pass-fail Overall row', async () => {
    const perf = await as(
      supertest(app.getHttpServer()).get(`${API}/performance/classes/${SEED_CLASS_1_ID}?${year}`),
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    const analysis = await as(
      supertest(app.getHttpServer()).get(`${API}/exams/${examId}/analysis/pass-fail`),
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    expect(perf.body.exams).toHaveLength(1);
    expect(perf.body.passRate).toBe(analysis.body.overall.pass_pct);
    expect(perf.body.averageMarks).toBe(analysis.body.overall.average);
  });

  it('class and student numbers equal Analysis across several exams (unweighted mean per exam)', async () => {
    const other = await insertStudent(SEED_TENANT_ID, SEED_SECTION_1_ID);
    await ds.query(
      `INSERT INTO enrollments (id, tenant_id, student_id, class_id, section_id, academic_year_id, enrollment_status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'ACTIVE')`,
      [SEED_TENANT_ID, other, SEED_CLASS_1_ID, SEED_SECTION_1_ID, SEED_ACADEMIC_YEAR_ID],
    );
    const scaleId = (
      await ds.query(`SELECT grading_scale_id AS id FROM results WHERE exam_id = $1`, [examId])
    )[0].id;
    const insertResult = (exam: string, student: string, marks: number, fail: boolean) =>
      ds.query(
        `INSERT INTO results
           (exam_id, student_id, total_marks, gpa, grade, position, section_id, section_position,
            is_fail, grading_scale_id, grading_scale_revision, rule_version, computed_at, tenant_id,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 1, $6, 1, $7, $8, 1, 'nctb-v1', NOW(), $9, NOW(), NOW())`,
        [
          exam,
          student,
          marks,
          fail ? 0 : 3.5,
          fail ? 'F' : 'A-',
          SEED_SECTION_1_ID,
          fail,
          scaleId,
          SEED_TENANT_ID,
        ],
      );
    // Exam 1 (seeded): studentId 90 pass. Add `other` failing there, so pass rate is 50.
    await insertResult(examId, other, 30, true);
    const exam2 = (
      await ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'Perf Exam 2', $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [
          SEED_ACADEMIC_YEAR_ID,
          SEED_CLASS_1_ID,
          ExamKind.TERM,
          ExamStatus.PUBLISHED,
          SEED_TENANT_ID,
        ],
      )
    )[0].id;
    await insertResult(exam2, studentId, 55, false);
    // Exam 2 has ONE row, so the per-exam mean (75 / 57.5) differs from a pooled mean (66.7 / 58.33).

    const get = (path: string) =>
      as(supertest(app.getHttpServer()).get(`${API}${path}`), adminToken, UserRole.ADMIN).expect(
        200,
      );
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    const r2 = (x: number) => Math.round(x * 100) / 100;

    const pf = await Promise.all(
      [examId, exam2].map((id) => get(`/exams/${id}/analysis/pass-fail`)),
    );
    const merit = await Promise.all(
      [examId, exam2].map((id) => get(`/exams/${id}/analysis/merit`)),
    );

    const cls = await get(`/performance/classes/${SEED_CLASS_1_ID}?${year}`);
    expect(cls.body.exams).toHaveLength(2);
    expect(cls.body.passRate).toBe(75);
    expect(cls.body.averageMarks).toBe(57.5);
    expect(cls.body.passRate).toBe(r1(mean(pf.map((p) => p.body.overall.pass_pct))));
    expect(cls.body.averageMarks).toBe(r2(mean(pf.map((p) => p.body.overall.average))));

    const stu = await get(`/performance/students/${studentId}?${year}`);
    const rows = merit.map((m) =>
      m.body.rows.find((r: { student_id: string }) => r.student_id === studentId),
    );
    expect(stu.body.exams).toHaveLength(2);
    expect(stu.body.passRate).toBe(r1(mean(rows.map((r) => (r.is_fail ? 0 : 100)))));
    expect(stu.body.averageMarks).toBe(r2(mean(rows.map((r) => Number(r.total_marks)))));
    expect(stu.body.averageGpa).toBe(r2(mean(rows.map((r) => Number(r.gpa)))));
  });

  it('missing academicYearId is 400', async () => {
    await as(
      supertest(app.getHttpServer()).get(`${API}/performance/classes/${SEED_CLASS_1_ID}`),
      adminToken,
      UserRole.ADMIN,
    ).expect(400);
  });

  it('missing X-Tenant-ID is 401', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/performance/classes/${SEED_CLASS_1_ID}?${year}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
  });
});
