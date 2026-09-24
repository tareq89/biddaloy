import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { UserRole } from '@biddaloy/shared';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';
import { REQUIRED_HEADERS, BulkUploadHeader } from './homework-bulk-upload.parser';

/**
 * E2E tests for [22.3.3]'s CSV/Excel bulk homework import: full
 * validate → commit round trip, and the HOMEWORK_IMPORT permission gate.
 */

const SUBJECT_ID = randomUUID();

const DEFAULTS: Record<BulkUploadHeader, string> = {
  class: 'Class 1',
  section: 'Section A',
  subject: 'Mathematics 966',
  assigned_date: '2026-01-01',
  due_date: '2026-01-08',
  description: 'Chapter 1 exercises',
};

function rowValues(
  headers: readonly string[],
  overrides: Partial<Record<BulkUploadHeader, string>> = {},
): string[] {
  const merged = { ...DEFAULTS, ...overrides };
  return headers.map((h) => merged[h as BulkUploadHeader] ?? '');
}

async function buildXlsxBuffer(rows: string[][]): Promise<Buffer> {
  const headers = [...REQUIRED_HEADERS];
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Homework');
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('Homework Bulk Upload E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let teacherToken: string;
  let accountantToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const TEACHER_USER_ID = '00000000-0000-4000-8000-000000000966';
  const TEACHER_EMAIL = 'teacher-966@testschool.com';
  const ACCOUNTANT_USER_ID = '00000000-0000-4000-8000-000000000967';
  const ACCOUNTANT_EMAIL = 'accountant-966@testschool.com';

  function validate(
    buffer: Buffer,
    opts: { role?: UserRole; filename?: string; as?: string } = {},
  ) {
    return supertest(app.getHttpServer())
      .post('/api/v1/homework/bulk/validate')
      .set('Authorization', `Bearer ${opts.as ?? token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', opts.role ?? UserRole.ADMIN)
      .attach('file', buffer, opts.filename ?? 'homework.xlsx');
  }

  function commit(stagingId: string, opts: { role?: UserRole; as?: string } = {}) {
    return supertest(app.getHttpServer())
      .post('/api/v1/homework/bulk/commit')
      .set('Authorization', `Bearer ${opts.as ?? token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', opts.role ?? UserRole.ADMIN)
      .send({ staging_id: stagingId });
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
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

    // ADMIN already holds HOMEWORK_IMPORT (D26) via the seeded admin user.
    // Add a TEACHER (also holds it) and an ACCOUNTANT (does not) for the
    // permission-gate assertions.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       SELECT $1, $2, password_hash, 'Teacher 966', 'ACTIVE', NOW(), NOW() FROM users WHERE email = $3
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       SELECT $1, $2, password_hash, 'Accountant 966', 'ACTIVE', NOW(), NOW() FROM users WHERE email = $3
       ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, ACCOUNTANT_EMAIL, SEED_ADMIN_EMAIL],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, TENANT_ID, UserRole.ACCOUNTANT],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;

    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: TEACHER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    const accountantLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ACCOUNTANT_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    accountantToken = accountantLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // `subjects` is a transactional table (test/reset-order.ts), cleared
  // before every test by the global `beforeEach` in test/setup.ts — so the
  // subject these rows resolve against must be re-inserted per test, not
  // just once in `beforeAll`.
  beforeEach(async () => {
    await dataSource.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, is_active, created_at, updated_at)
       VALUES ($1, $2, 'Mathematics 966', 'MATH966', true, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUBJECT_ID, TENANT_ID],
    );
  });

  describe('POST /homework/bulk/validate + commit', () => {
    it('validates a valid .xlsx without writing, then commits it', async () => {
      const buffer = await buildXlsxBuffer([rowValues(REQUIRED_HEADERS)]);

      const countBefore = Number(
        (await dataSource.query('SELECT COUNT(*)::int AS n FROM homework'))[0].n,
      );

      const validateRes = await validate(buffer).expect(201);
      expect(validateRes.body.rows_to_create).toBe(1);
      expect(validateRes.body.hard_error_count).toBe(0);
      expect(validateRes.body.staging_id).toBeTruthy();

      const countAfterValidate = Number(
        (await dataSource.query('SELECT COUNT(*)::int AS n FROM homework'))[0].n,
      );
      expect(countAfterValidate).toBe(countBefore);

      const commitRes = await commit(validateRes.body.staging_id).expect(201);
      expect(commitRes.body).toMatchObject({ total_rows: 1, success_count: 1, error_count: 0 });
      expect(commitRes.body.created_homework_ids).toHaveLength(1);

      const homeworkRow = (
        await dataSource.query('SELECT * FROM homework WHERE id = $1', [
          commitRes.body.created_homework_ids[0],
        ])
      )[0];
      expect(homeworkRow.grading_mode).toBe('TICK');

      const assignmentRows = await dataSource.query(
        'SELECT * FROM homework_assignments WHERE homework_id = $1',
        [commitRes.body.created_homework_ids[0]],
      );
      expect(assignmentRows).toHaveLength(1);
      expect(assignmentRows[0].section_id).toBeTruthy();
      expect(assignmentRows[0].student_id).toBeNull();
    });

    it('holds HOMEWORK_IMPORT but has no teacher_class_sections row for the row (access checked in validate)', async () => {
      const buffer = await buildXlsxBuffer([rowValues(REQUIRED_HEADERS)]);
      const validateRes = await validate(buffer, { role: UserRole.TEACHER, as: teacherToken }).expect(
        201,
      );
      expect(validateRes.body.hard_error_count).toBe(1);
      expect(validateRes.body.errors[0]).toMatchObject({ column: 'section' });
      await commit(validateRes.body.staging_id, { role: UserRole.TEACHER, as: teacherToken }).expect(
        409,
      );
    });

    it('returns 401 for ACCOUNTANT (role not allowed)', async () => {
      const buffer = await buildXlsxBuffer([rowValues(REQUIRED_HEADERS)]);

      const res = await validate(buffer, { role: UserRole.ACCOUNTANT, as: accountantToken }).expect(
        401,
      );
      expect(res.body.message).toContain('Requires one of roles');
    });

    it('an unknown class/section/subject blocks commit entirely', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS),
        rowValues(REQUIRED_HEADERS, { subject: 'No Such Subject' }),
      ]);

      const validateRes = await validate(buffer).expect(201);
      expect(validateRes.body.rows_to_create).toBe(1);
      expect(validateRes.body.hard_error_count).toBe(1);
      expect(validateRes.body.errors[0]).toMatchObject({
        row: 3,
        column: 'subject',
        value: 'No Such Subject',
      });

      await commit(validateRes.body.staging_id).expect(409);
    });

    it('404s on committing an already-consumed staging id', async () => {
      const buffer = await buildXlsxBuffer([rowValues(REQUIRED_HEADERS)]);
      const validateRes = await validate(buffer).expect(201);
      await commit(validateRes.body.staging_id).expect(201);
      await commit(validateRes.body.staging_id).expect(404);
    });
  });
});
