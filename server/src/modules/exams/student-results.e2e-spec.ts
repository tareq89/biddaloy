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
});
