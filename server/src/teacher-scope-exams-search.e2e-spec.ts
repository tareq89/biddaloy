import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExamKind, ExamStatus, UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_CLASS_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import {
  createTeacherScopeFixture,
  TeacherScopeFixture,
} from '@test/helpers/teacher-scope.fixture';

/**
 * Epic 75 (75.6-e): a TEACHER's exam results, results analysis and palette search cover only the
 * students of their current-year assigned sections (D2). A miss is a 404, an empty set an empty
 * list (D13). Other roles see everything, as before.
 *
 * Fixture: teacher has section A (current year); B has no assignment; C is a past-year section.
 * One PROCESSED exam holds a result for each of the three students.
 */
const API = '/api/v1';

describe('Teacher scope: exam results, analysis, search (75.6-e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fx: TeacherScopeFixture;
  let teacherToken: string;
  let adminToken: string;
  let controllerToken: string;
  let examId: string;
  let scaleId: string;
  let controllerUserId: string;
  const controllerEmail = `ts-exam-controller-${Math.random().toString(36).slice(2, 8)}@e2e.example`;

  const call = (path: string, token: string, role: UserRole) =>
    supertest(app.getHttpServer())
      .get(`${API}${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);
  const asTeacher = (path: string) => call(path, teacherToken, UserRole.TEACHER);
  const login = async (email: string) =>
    (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    fx = await createTeacherScopeFixture(app, dataSource);
    teacherToken = await fx.login();
    adminToken = await login(SEED_ADMIN_EMAIL);

    const [u] = await dataSource.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, 'TS Exam Controller', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [controllerEmail, SEED_ADMIN_PASSWORD_HASH],
    );
    controllerUserId = u.id;
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [controllerUserId, SEED_TENANT_ID, UserRole.EXAM_CONTROLLER],
    );
    controllerToken = await login(controllerEmail);
  }, 120000);

  afterAll(async () => {
    await dataSource?.query(`DELETE FROM results WHERE exam_id = $1`, [examId]);
    await dataSource?.query(`DELETE FROM exams WHERE id = $1`, [examId]);
    await dataSource?.query(`DELETE FROM grading_scales WHERE id = $1`, [scaleId]);
    await dataSource?.query(`DELETE FROM user_tenants WHERE user_id = $1`, [controllerUserId]);
    await dataSource?.query(`DELETE FROM users WHERE id = $1`, [controllerUserId]);
    await fx?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    await fx.seed();
    // exams / grading_scales are truncated before every test too, so they are made per test.
    const [scale] = await dataSource.query(
      `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ('TS scale', 1, $1, $2, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID],
    );
    scaleId = scale.id;
    const [exam] = await dataSource.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'TS Scope Exam', $3, $4, $5, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.TERM, ExamStatus.PROCESSED, SEED_TENANT_ID],
    );
    examId = exam.id;
    const rows: [string, string, number][] = [
      [fx.studentA, fx.sectionA, 1],
      [fx.studentB, fx.sectionB, 2],
      [fx.studentC, fx.sectionC, 3],
    ];
    // `GET /results/:studentId` 500s on a result with no result_subjects row (results.service.ts
    // `In([''])`), so every result gets one subject.
    const [subject] = await dataSource.query(
      `INSERT INTO subjects (tenant_id, name_en, code) VALUES ($1, 'TS Exam Subject', $2) RETURNING id`,
      [SEED_TENANT_ID, `TSE${Math.random().toString(36).slice(2, 8)}`],
    );
    for (const [studentId, sectionId, position] of rows) {
      const [result] = await dataSource.query(
        `INSERT INTO results
           (exam_id, student_id, section_id, total_marks, gpa, grade, position, section_position, is_fail,
            grading_scale_id, grading_scale_revision, rule_version, computed_at, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, 90.00, 5.00, 'A+', $4, 1, false, $5, 1, 'nctb-v1', NOW(), $6, NOW(), NOW())
         RETURNING id`,
        [examId, studentId, sectionId, position, scaleId, SEED_TENANT_ID],
      );
      await dataSource.query(
        `INSERT INTO result_subjects
           (result_id, subject_id, obtained, grade, gpa, is_fail, is_fourth_subject, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 90.00, 'A+', 5.00, false, false, $3, NOW(), NOW())`,
        [result.id, subject.id, SEED_TENANT_ID],
      );
    }
  });

  const studentIds = (rows: { student_id: string }[]) => rows.map((r) => r.student_id).sort();

  describe('TEACHER', () => {
    // The repro: before this ticket the list returned all three.
    it('a teacher of section A does not see section B results', async () => {
      const res = await asTeacher(`/exams/${examId}/results`).expect(200);
      expect(studentIds(res.body)).toEqual([fx.studentA]);
    });

    it('results/:studentId is 404 for B and C, 200 for A', async () => {
      await asTeacher(`/exams/${examId}/results/${fx.studentB}`).expect(404);
      await asTeacher(`/exams/${examId}/results/${fx.studentC}`).expect(404);
      await asTeacher(`/exams/${examId}/results/${fx.studentA}`).expect(200);
    });

    // Was a 500 (`In([''])` on a uuid column) before review r1.
    it('results/:studentId for a result with no subject rows is 200 with empty subjects', async () => {
      await dataSource.query(`DELETE FROM result_subjects WHERE tenant_id = $1`, [SEED_TENANT_ID]);
      const res = await asTeacher(`/exams/${examId}/results/${fx.studentA}`).expect(200);
      expect(res.body.subjects).toEqual([]);
    });

    it('analysis/merit lists only A; ?section_id=B is 404; ?section_id=A is fine', async () => {
      const res = await asTeacher(`/exams/${examId}/analysis/merit`).expect(200);
      expect(studentIds(res.body.rows)).toEqual([fx.studentA]);
      await asTeacher(`/exams/${examId}/analysis/merit?section_id=${fx.sectionB}`).expect(404);
      const a = await asTeacher(`/exams/${examId}/analysis/merit?section_id=${fx.sectionA}`).expect(
        200,
      );
      expect(studentIds(a.body.rows)).toEqual([fx.studentA]);
    });

    it('defaulted, pass-fail and pass-fail/components count only section A', async () => {
      await dataSource.query(`UPDATE results SET is_fail = true WHERE exam_id = $1`, [examId]);
      const defaulted = await asTeacher(`/exams/${examId}/analysis/defaulted`).expect(200);
      expect(studentIds(defaulted.body.rows)).toEqual([fx.studentA]);
      const passFail = await asTeacher(`/exams/${examId}/analysis/pass-fail`).expect(200);
      expect(passFail.body.overall.appeared).toBe(1);
      await asTeacher(`/exams/${examId}/analysis/pass-fail/components`).expect(200);
      await asTeacher(`/exams/${examId}/analysis/pass-fail?section_id=${fx.sectionC}`).expect(404);
    });

    it('merit.csv, defaulted.csv and pass-fail.csv cover only section A', async () => {
      const csv = await asTeacher(`/exams/${examId}/analysis/merit.csv`).expect(200);
      expect(csv.text).toContain('TS Student A');
      expect(csv.text).not.toContain('TS Student B');
      expect(csv.text).not.toContain('TS Student C');
      for (const f of ['merit', 'defaulted', 'pass-fail']) {
        await asTeacher(`/exams/${examId}/analysis/${f}.csv?section_id=${fx.sectionB}`).expect(404);
      }
    });

    it('GET /search returns student A and guardian A, never B or C; staff group stays open', async () => {
      const res = await asTeacher(`/search?q=${encodeURIComponent('TS Student')}&limit=10`).expect(
        200,
      );
      expect(res.body.students.map((s: { id: string }) => s.id)).toEqual([fx.studentA]);
      const g = await asTeacher(`/search?q=${encodeURIComponent('TS Guardian')}&limit=10`).expect(
        200,
      );
      expect(g.body.guardians.map((x: { id: string }) => x.id)).toEqual([fx.guardianA]);
      expect(Array.isArray(g.body.staff)).toBe(true);
    });

    it('a teacher with no assignment gets empty students and guardians from /search and results', async () => {
      await dataSource.query(`DELETE FROM teacher_class_sections WHERE tenant_id = $1`, [
        SEED_TENANT_ID,
      ]);
      const res = await asTeacher(`/search?q=TS&limit=10`).expect(200);
      expect(res.body.students).toEqual([]);
      expect(res.body.guardians).toEqual([]);
      const list = await asTeacher(`/exams/${examId}/results`).expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe.each([
    ['ADMIN', UserRole.ADMIN, () => adminToken],
    ['EXAM_CONTROLLER', UserRole.EXAM_CONTROLLER, () => controllerToken],
  ])('%s is unchanged', (_name, role, token) => {
    it('sees all three students on results, merit and a section filter', async () => {
      const all = [fx.studentA, fx.studentB, fx.studentC].sort();
      const list = await call(`/exams/${examId}/results`, token(), role).expect(200);
      expect(studentIds(list.body)).toEqual(all);
      const merit = await call(`/exams/${examId}/analysis/merit`, token(), role).expect(200);
      expect(studentIds(merit.body.rows)).toEqual(all);
      await call(`/exams/${examId}/results/${fx.studentB}`, token(), role).expect(200);
      await call(`/exams/${examId}/analysis/merit?section_id=${fx.sectionB}`, token(), role).expect(
        200,
      );
    });
  });

  it('ADMIN search is unchanged: sees students of every section', async () => {
    const res = await call(
      `/search?q=${encodeURIComponent('TS Student')}&limit=10`,
      adminToken,
      UserRole.ADMIN,
    ).expect(200);
    const ids = res.body.students.map((s: { id: string }) => s.id);
    expect(ids).toEqual(expect.arrayContaining([fx.studentA, fx.studentB, fx.studentC]));
  });

  it('a tenant the teacher does not belong to is refused (ContextGuard 401, unchanged)', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/exams/${examId}/results`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', '00000000-0000-4000-8000-0000000000ff')
      .set('X-Role', UserRole.TEACHER)
      .expect(401);
  });
});
