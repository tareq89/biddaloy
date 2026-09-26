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
 * [997] `GET /exams/:examId/analysis/*` — cloned from
 * `student-results.e2e-spec.ts`'s login/fixture scaffolding. Covers the
 * permission gate, tenant isolation, and the CSV formula-injection guard;
 * `analysis.service.spec.ts` covers the per-endpoint arithmetic.
 */
const API = '/api/v1';

describe('[997] Exam analysis (merit/defaulted/pass-fail)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let http: () => supertest.SuperTest<supertest.Test>;

  const TENANT_ID = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-0000009970b0';
  const TEACHER_USER_ID = '00000000-0000-4000-8000-0000009970a1';
  const TEACHER_EMAIL = 'analysis-teacher@e2e.example';
  const GUARDIAN_USER_ID = '00000000-0000-4000-8000-0000009970c1';
  const GUARDIAN_EMAIL = 'analysis-guardian@e2e.example';

  let examId: string;
  let otherTenantExamId: string;
  let adminToken: string;
  let teacherToken: string;
  let guardianToken: string;

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
       VALUES ($1, $2, $3, 'Analysis Teacher', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_ID, UserRole.TEACHER],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Analysis Guardian', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [GUARDIAN_USER_ID, GUARDIAN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [GUARDIAN_USER_ID, TENANT_ID, UserRole.PARENT],
    );
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Analysis Other School', 'analysis-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );

    const login = async (email: string): Promise<string> => {
      const res = await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token;
    };
    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
    guardianToken = await login(GUARDIAN_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  async function seedFixture(): Promise<void> {
    const scaleRows = await dataSource.query(
      `INSERT INTO grading_scales (name, revision, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ('NCTB', 1, $1, $2, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, TENANT_ID],
    );
    const scaleId = scaleRows[0].id;
    await dataSource.query(
      `INSERT INTO grading_bands
         (scale_id, percent_from, percent_to, grade, gpa, is_fail, sequence, tenant_id, created_at, updated_at)
       VALUES ($1, 80, 100, 'A+', 5.00, false, 1, $2, NOW(), NOW())`,
      [scaleId, TENANT_ID],
    );

    const examRows = await dataSource.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Analysis Term Exam', $3, $4, $5, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.TERM, ExamStatus.PROCESSED, TENANT_ID],
    );
    examId = examRows[0].id;

    const studentRows = await dataSource.query(
      `INSERT INTO students
         (full_name, registration_number, roll_number, class_section_id, tenant_id,
          enrollment_status, preferred_communication, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'SMS', NOW(), NOW())
       RETURNING id`,
      [
        '=cmd|Injected Name',
        `AR-${Math.random().toString(36).slice(2, 12)}`,
        Math.floor(Math.random() * 1000000),
        SEED_SECTION_1_ID,
        TENANT_ID,
      ],
    );
    const studentId = studentRows[0].id;

    await dataSource.query(
      `INSERT INTO results
         (exam_id, student_id, total_marks, gpa, grade, position, section_id, section_position,
          is_fail, grading_scale_id, grading_scale_revision, rule_version, computed_at, tenant_id,
          created_at, updated_at)
       VALUES ($1, $2, 90.00, 5.00, 'A+', 1, $3, 1, false, $4, 1, 'nctb-v1', NOW(), $5, NOW(), NOW())`,
      [examId, studentId, SEED_SECTION_1_ID, scaleId, TENANT_ID],
    );

    // A second tenant's exam, for the 404 test.
    const otherExamRows = await dataSource.query(
      `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
       VALUES ($1, $2, 'Other Tenant Exam', $3, $4, $5, NOW(), NOW()) RETURNING id`,
      [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, ExamKind.TERM, ExamStatus.PROCESSED, TENANT_B],
    );
    otherTenantExamId = otherExamRows[0].id;
  }

  describe('GET /exams/:examId/analysis/merit', () => {
    it('a TEACHER gets 200', async () => {
      await seedFixture();

      const res = await http()
        .get(`${API}/exams/${examId}/analysis/merit`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);

      expect(res.body.status).toBe(ExamStatus.PROCESSED);
      expect(res.body.rows).toHaveLength(1);
    });

    it('a GUARDIAN (PARENT) gets 401 — role not in @Roles, matching the RolesGuard convention', async () => {
      await seedFixture();

      await http()
        .get(`${API}/exams/${examId}/analysis/merit`)
        .set('Authorization', `Bearer ${guardianToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.PARENT)
        .expect(401);
    });

    it("another tenant's exam gets 404", async () => {
      await seedFixture();

      await http()
        .get(`${API}/exams/${otherTenantExamId}/analysis/merit`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(404);
    });
  });

  describe('GET /exams/:examId/analysis/merit.csv', () => {
    it('has a header row and escapes a cell starting with "="', async () => {
      await seedFixture();

      const res = await http()
        .get(`${API}/exams/${examId}/analysis/merit.csv`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      const text = (res.text as string).replace(/^﻿/, '');
      const lines = text.split('\r\n');
      expect(lines[0]).toContain('Roll');
      // The injected student name ("=cmd|Injected Name") must be
      // formula-escaped with a leading apostrophe, not passed through raw.
      expect(text).toContain("'=cmd|Injected Name");
    });
  });
});
