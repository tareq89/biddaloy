import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { REQUIRED_HEADERS, BulkUploadHeader } from './bulk-upload.parser';

/**
 * E2E tests for the Bulk Student-Guardian Upload API (issue #10, split into
 * validate + commit by #605/[14.9.1]).
 *
 * `POST /students/bulk-upload` (write-on-upload) no longer exists — every
 * test here drives `POST /students/bulk-upload/validate` then
 * `POST /students/bulk-upload/commit`, the real two-step flow.
 */

const OTHER_USER_ID = '00000000-0000-4000-8000-000000000605';
const OTHER_USER_EMAIL = 'other-admin-605@testschool.com';

const DEFAULTS: Record<BulkUploadHeader, string> = {
  student_name: 'Alice Rahman',
  class: 'Class 1',
  section: 'Section A',
  roll: '',
  registration_number: '',
  guardian1_name: 'Karim Rahman',
  guardian1_phone: '+8801711111111',
  guardian1_email: '',
  guardian2_name: '',
  guardian2_phone: '',
  guardian2_email: '',
  home_address: '',
  preferred_communication: '',
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
  const worksheet = workbook.addWorksheet('Students');
  worksheet.addRow(headers);
  for (const row of rows) worksheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('Bulk Student Upload E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let otherUserToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  function validate(
    buffer: Buffer,
    opts: { role?: UserRole; filename?: string; as?: string } = {},
  ) {
    return supertest(app.getHttpServer())
      .post('/api/v1/students/bulk-upload/validate')
      .set('Authorization', `Bearer ${opts.as ?? token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', opts.role ?? UserRole.ADMIN)
      .attach('file', buffer, opts.filename ?? 'students.xlsx');
  }

  function commit(stagingId: string, opts: { role?: UserRole; as?: string } = {}) {
    return supertest(app.getHttpServer())
      .post('/api/v1/students/bulk-upload/commit')
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

    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.ACCOUNTANT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.EXECUTIVE],
    );

    // A second user in the same tenant, for cross-user staging isolation.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Other Admin 605', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_USER_ID, OTHER_USER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_USER_ID, TENANT_ID, UserRole.ADMIN],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;

    const otherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: OTHER_USER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    otherUserToken = otherLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /students/bulk-upload/validate + commit', () => {
    it('validates a valid .xlsx without creating students, then commits it', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '101', guardian1_phone: '+8801711110001' }),
      ]);

      const countBefore = Number(
        (await dataSource.query('SELECT COUNT(*)::int AS n FROM students'))[0].n,
      );

      const validateRes = await validate(buffer).expect(201);
      expect(validateRes.body.rows_to_create).toBe(1);
      expect(validateRes.body.hard_error_count).toBe(0);
      expect(validateRes.body.preview).toHaveLength(1);
      expect(validateRes.body.staging_id).toBeTruthy();

      const countAfterValidate = Number(
        (await dataSource.query('SELECT COUNT(*)::int AS n FROM students'))[0].n,
      );
      expect(countAfterValidate).toBe(countBefore);

      const commitRes = await commit(validateRes.body.staging_id).expect(201);
      expect(commitRes.body).toMatchObject({ total_rows: 1, success_count: 1, error_count: 0 });
      expect(commitRes.body.created_student_ids).toHaveLength(1);
    });

    it('allows ACCOUNTANT and EXECUTIVE roles on both steps', async () => {
      for (const role of [UserRole.ACCOUNTANT, UserRole.EXECUTIVE]) {
        const buffer = await buildXlsxBuffer([
          rowValues(REQUIRED_HEADERS, {
            roll: role === UserRole.ACCOUNTANT ? '102' : '103',
            guardian1_phone: role === UserRole.ACCOUNTANT ? '+8801711110002' : '+8801711110003',
          }),
        ]);
        const validateRes = await validate(buffer, { role }).expect(201);
        await commit(validateRes.body.staging_id, { role }).expect(201);
      }
    });

    it('returns 401 for TEACHER role on validate', async () => {
      const buffer = await buildXlsxBuffer([rowValues(REQUIRED_HEADERS)]);

      const res = await validate(buffer, { role: UserRole.TEACHER }).expect(401);
      expect(res.body.message).toContain('Requires one of roles');
    });

    it('a row error blocks commit entirely, even though good rows exist', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '104', guardian1_phone: '+8801711110004' }),
        rowValues(REQUIRED_HEADERS, { roll: '105', guardian1_phone: 'not-a-phone' }),
      ]);

      const validateRes = await validate(buffer).expect(201);
      expect(validateRes.body.rows_to_create).toBe(1);
      expect(validateRes.body.hard_error_count).toBe(1);
      expect(validateRes.body.errors[0]).toMatchObject({ row: 3, column: 'guardian1_phone' });
      expect(validateRes.body.errors[0].message).toContain('Invalid phone format');

      // The server refuses the commit outright — it does not silently
      // import the one good row.
      await commit(validateRes.body.staging_id).expect(409);

      const countAfter = Number(
        (await dataSource.query('SELECT COUNT(*)::int AS n FROM students'))[0].n,
      );
      // No student created for either row.
      const created = await dataSource.query(
        "SELECT COUNT(*)::int AS n FROM students WHERE full_name = 'Alice Rahman' AND roll_number IN (104, 105)",
      );
      expect(Number(created[0].n)).toBe(0);
      void countAfter;
    });

    it('returns 400 with a specific message when required columns are missing', async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Students');
      worksheet.addRow(['student_name', 'class']); // missing most required headers
      worksheet.addRow(['Alice', 'Class 1']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const res = await validate(buffer).expect(400);
      expect(res.body.message).toContain('Missing required columns');
    });

    it('returns 400 for an unsupported file type', async () => {
      const res = await validate(Buffer.from('hello'), { filename: 'students.pdf' }).expect(400);
      expect(res.body.message).toContain('Unsupported file type');
    });

    it('returns 400 when no file is attached', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload/validate')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(400);
    });

    it('rejects a file larger than the 5MB limit', async () => {
      const oversized = Buffer.alloc(6 * 1024 * 1024, 'a');
      const res = await validate(oversized);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('accepts a valid .csv with the same schema', async () => {
      const headers = [...REQUIRED_HEADERS];
      const values = rowValues(headers, { roll: '106', guardian1_phone: '+8801711110006' });
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const csv = [headers.map(escape).join(','), values.map(escape).join(',')].join('\n');

      const res = await validate(Buffer.from(csv, 'utf-8'), { filename: 'students.csv' }).expect(
        201,
      );
      expect(res.body.rows_to_create).toBe(1);
    });

    it('404s on a second commit of the same staging_id', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '107', guardian1_phone: '+8801711110007' }),
      ]);
      const validateRes = await validate(buffer).expect(201);
      await commit(validateRes.body.staging_id).expect(201);
      await commit(validateRes.body.staging_id).expect(404);
    });

    it("404s committing another user's staging_id, even within the same tenant", async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '108', guardian1_phone: '+8801711110008' }),
      ]);
      const validateRes = await validate(buffer).expect(201);
      await commit(validateRes.body.staging_id, { as: otherUserToken }).expect(404);
    });
  });
});
