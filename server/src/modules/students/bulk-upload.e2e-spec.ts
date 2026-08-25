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
} from '@test/constants';
import { REQUIRED_HEADERS, BulkUploadHeader } from './bulk-upload.parser';

/**
 * E2E tests for the Bulk Student-Guardian Upload API (issue #10).
 *
 * Tests RBAC and the end-to-end shape of POST /students/bulk-upload,
 * driving the real multipart upload path with supertest's `.attach()`.
 */

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

  const TENANT_ID = SEED_TENANT_ID;

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

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /students/bulk-upload', () => {
    it('uploads a valid .xlsx for ADMIN role and returns a success report', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '101', guardian1_phone: '+8801711110001' }),
      ]);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .attach('file', buffer, 'students.xlsx')
        .expect(201);

      expect(res.body).toMatchObject({ total_rows: 1, success_count: 1, error_count: 0 });
      expect(res.body.created_student_ids).toHaveLength(1);
    });

    it('allows ACCOUNTANT role', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '102', guardian1_phone: '+8801711110002' }),
      ]);

      await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ACCOUNTANT)
        .attach('file', buffer, 'students.xlsx')
        .expect(201);
    });

    // [8.11.8] EXECUTIVE is on the route's `@Roles` list and now holds
    // STUDENT_BULK_UPLOAD in ROLE_PERMISSIONS. Without this case, dropping
    // the role from the decorator would leave every test green while the UI
    // kept offering an import that 401s.
    it('allows EXECUTIVE role', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '103', guardian1_phone: '+8801711110003' }),
      ]);

      await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.EXECUTIVE)
        .attach('file', buffer, 'students.xlsx')
        .expect(201);
    });

    it('returns 401 for TEACHER role', async () => {
      const buffer = await buildXlsxBuffer([rowValues(REQUIRED_HEADERS)]);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .attach('file', buffer, 'students.xlsx')
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('returns a per-row error report for a mix of good and bad rows', async () => {
      const buffer = await buildXlsxBuffer([
        rowValues(REQUIRED_HEADERS, { roll: '103', guardian1_phone: '+8801711110003' }),
        rowValues(REQUIRED_HEADERS, { roll: '104', guardian1_phone: 'not-a-phone' }),
      ]);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .attach('file', buffer, 'students.xlsx')
        .expect(201);

      expect(res.body.success_count).toBe(1);
      expect(res.body.error_count).toBe(1);
      expect(res.body.errors[0]).toMatchObject({
        row: 3,
        field: 'guardian1_phone',
        value: 'not-a-phone',
      });
      expect(res.body.errors[0].reason).toContain('Invalid phone format');
    });

    it('returns 400 with a specific message when required columns are missing', async () => {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Students');
      worksheet.addRow(['student_name', 'class']); // missing most required headers
      worksheet.addRow(['Alice', 'Class 1']);
      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .attach('file', buffer, 'students.xlsx')
        .expect(400);

      expect(res.body.message).toContain('Missing required columns');
    });

    it('returns 400 for an unsupported file type', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .attach('file', Buffer.from('hello'), 'students.pdf')
        .expect(400);

      expect(res.body.message).toContain('Unsupported file type');
    });

    it('returns 400 when no file is attached', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(400);
    });

    it('rejects a file larger than the 5MB limit', async () => {
      const oversized = Buffer.alloc(6 * 1024 * 1024, 'a');

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .attach('file', oversized, 'students.xlsx');

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    it('accepts a valid .csv with the same schema', async () => {
      const headers = [...REQUIRED_HEADERS];
      const values = rowValues(headers, { roll: '105', guardian1_phone: '+8801711110005' });
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const csv = [headers.map(escape).join(','), values.map(escape).join(',')].join('\n');

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/students/bulk-upload')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .attach('file', Buffer.from(csv, 'utf-8'), 'students.csv')
        .expect(201);

      expect(res.body.success_count).toBe(1);
    });
  });
});
