import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { AllExceptionsFilter } from '../../common/filters/http-exception.filter';
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
    // The real app registers this in main.ts; it turns a parser's ImportFileError into a 400.
    app.useGlobalFilters(new AllExceptionsFilter());
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

    describe('[3250] demo row cap', () => {
      const saved = process.env.DEMO_MODE;
      afterEach(() => {
        vi.restoreAllMocks();
        if (saved === undefined) delete process.env.DEMO_MODE;
        else process.env.DEMO_MODE = saved;
      });

      const rows101 = () =>
        Array.from({ length: 101 }, (_, i) =>
          rowValues(REQUIRED_HEADERS, {
            roll: String(i + 1),
            guardian1_phone: `+88017${String(30000000 + i)}`,
          }),
        );

      it('refuses 101 rows with 422 DEMO_ROW_LIMIT and writes nothing', async () => {
        process.env.DEMO_MODE = 'true';
        // The demo deny-list (DemoModeGuard) still blocks this route today; hide DEMO_MODE from
        // that guard only, so the cap itself (which reads process.env) is what answers.
        const config = app.get(ConfigService);
        const realGet = config.get.bind(config);
        vi.spyOn(config, 'get').mockImplementation(((k: string, ...a: unknown[]) =>
          k === 'DEMO_MODE'
            ? undefined
            : (realGet as (...x: unknown[]) => unknown)(k, ...a)) as never);
        const before = Number(
          (await dataSource.query('SELECT COUNT(*)::int AS n FROM students'))[0].n,
        );
        const res = await validate(await buildXlsxBuffer(rows101()));
        expect(res.status).toBe(422);
        expect(res.body.details).toEqual({ code: 'DEMO_ROW_LIMIT', limit: 100, count: 101 });
        expect(res.body.message).toBe('Demo: at most 100 rows per request');
        const after = Number(
          (await dataSource.query('SELECT COUNT(*)::int AS n FROM students'))[0].n,
        );
        expect(after).toBe(before);
      });

      it('the same 101-row file is still validated without DEMO_MODE', async () => {
        delete process.env.DEMO_MODE;
        const res = await validate(await buildXlsxBuffer(rows101()));
        expect(res.status).toBe(201);
        expect(res.body.rows_to_create + res.body.hard_error_count).toBe(101);
      });
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

    it('LIFE-12: re-uploading an imported file reports one error per row and commit is refused', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, {
          student_name: 'Reupload One',
          guardian1_phone: '+8801711120001',
        }),
        rowValues(REQUIRED_HEADERS, {
          student_name: 'Reupload Two',
          guardian1_phone: '+8801711120002',
        }),
      ]);
      const first = await validate(buffer).expect(201);
      expect(first.body.hard_error_count).toBe(0);
      await commit(first.body.staging_id).expect(201);

      const second = await validate(buffer).expect(201);
      const errs = second.body.errors.filter((e: { severity: string }) => e.severity === 'error');
      expect(errs).toHaveLength(2);
      expect(errs[0].message).toContain('Already imported');
      await commit(second.body.staging_id).expect(409);
    });

    it('returns 403 for TEACHER role on validate', async () => {
      const buffer = await buildXlsxBuffer([rowValues(REQUIRED_HEADERS)]);

      const res = await validate(buffer, { role: UserRole.TEACHER }).expect(403);
      expect(res.body.message).toContain('Requires permission(s)');
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

    it('[2606] a roll above the cap is a hard error on roll and commit is refused', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '2147483648', guardian1_phone: '+8801711110061' }),
      ]);
      const res = await validate(buffer).expect(201);
      expect(res.body.hard_error_count).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ row: 2, column: 'roll' });
      await commit(res.body.staging_id).expect(409);
    });

    it('[2607] stores a supplied registration number; a second upload of it is refused', async () => {
      const reg = `QA-E2E-${Date.now()}`;
      const rows = (phone: string) => [
        rowValues(REQUIRED_HEADERS, {
          student_name: `Reg E2E ${reg}`,
          registration_number: reg,
          guardian1_phone: phone,
        }),
      ];
      const v1 = await validate(await buildXlsxBuffer(rows('+8801711110071'))).expect(201);
      const c1 = await commit(v1.body.staging_id).expect(201);
      const stored = await dataSource.query(
        'SELECT registration_number FROM students WHERE id = $1',
        [c1.body.created_student_ids[0]],
      );
      expect(stored[0].registration_number).toBe(reg);

      const v2 = await validate(await buildXlsxBuffer(rows('+8801711110072'))).expect(201);
      expect(v2.body.hard_error_count).toBe(1);
      expect(v2.body.errors[0]).toMatchObject({ column: 'registration_number' });
      await commit(v2.body.staging_id).expect(409);
    });

    it('returns 400 with a specific message when required columns are missing', async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Students');
      worksheet.addRow(['student_name', 'class']); // missing most required headers
      worksheet.addRow(['Alice', 'Class 1']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const res = await validate(buffer).expect(400);
      expect(res.body.message).toContain('Missing required columns');
      expect(res.body.details).toEqual({ code: 'IMPORT_FILE_MISSING_COLUMNS' });
    });

    it('returns 400 for an unsupported file type', async () => {
      const res = await validate(Buffer.from('hello'), { filename: 'students.pdf' }).expect(400);
      expect(res.body.message).toContain('Unsupported file type');
      expect(res.body.details).toEqual({ code: 'IMPORT_FILE_UNSUPPORTED_TYPE' });
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
