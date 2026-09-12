import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { StorageService } from '../../storage/storage.service';
import { ImportStagingService } from '../../bulk-import/import-staging.service';
import type { StagedValidation } from './import.controller';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const OTHER_USER_ID = '00000000-0000-4000-8000-000000000602';
const OTHER_USER_EMAIL = 'other-admin-604@testschool.com';

const FIXTURES_DIR = join(__dirname, '../../../../test/fixtures/workbook');
const VALID_XLSX = readFileSync(join(FIXTURES_DIR, 'valid.xlsx'));
const THREE_ERRORS_XLSX = readFileSync(join(FIXTURES_DIR, 'three-errors.xlsx'));

/**
 * E2E tests for `POST /backup/validate` and its error CSV download (#604).
 *
 * Only the `school` tab exists in `ALL_TABS` at the time this lands (the
 * other tabs land in still-in-flight lanes of epic 14.0), so
 * `three-errors.xlsx` exercises the error kinds `school` itself can
 * produce — see `test/fixtures/workbook/make-fixtures.ts` for the full
 * rationale.
 */
describe('POST /backup/validate E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let otherUserToken: string;

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
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.ADMIN],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    // A second ADMIN in the same tenant, so cross-user isolation can be
    // exercised without tripping ContextGuard's "not a member of this
    // tenant" 401, which would fire before the controller's own 404 check.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Other Admin', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
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

  it('accepts a valid workbook, stages it, and returns a preview with zero errors', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', VALID_XLSX, 'valid.xlsx')
      .expect(201);

    expect(res.body.staging_id).toBeTruthy();
    expect(res.body.expires_at).toBeTruthy();
    expect(res.body.errors).toHaveLength(0);
    expect(res.body.hard_error_count).toBe(0);
    // The storage key is an internal detail a restore needs, not something
    // the client should ever see.
    expect(res.body.workbook_storage_key).toBeUndefined();
  });

  it('persists the original upload so a restore can re-validate it later', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', VALID_XLSX, 'valid.xlsx')
      .expect(201);

    const staging = app.get(ImportStagingService);
    const storage = app.get(StorageService);

    const staged = await staging.peek<StagedValidation>(
      TENANT_ID,
      SEED_ADMIN_USER_ID,
      res.body.staging_id,
    );
    expect(staged?.workbook_storage_key).toBeTruthy();

    const stored = await storage.get(staged!.workbook_storage_key);
    const chunks: Buffer[] = [];
    for await (const chunk of stored.body) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(VALID_XLSX)).toBe(true);

    await storage.delete(staged!.workbook_storage_key);
  });

  it('reports exactly three errors, with tab/row/column, for three-errors.xlsx', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', THREE_ERRORS_XLSX, 'three-errors.xlsx')
      .expect(201);

    expect(res.body.errors).toHaveLength(3);
    expect(res.body.hard_error_count).toBe(3);
    for (const error of res.body.errors) {
      expect(error.tab).toBe('school');
      expect(typeof error.row).toBe('number');
    }
  });

  it('re-uploading returns a new staging_id and does not consume the old one', async () => {
    const first = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', VALID_XLSX, 'valid.xlsx')
      .expect(201);

    const second = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', VALID_XLSX, 'valid.xlsx')
      .expect(201);

    expect(second.body.staging_id).not.toBe(first.body.staging_id);

    // The first staging_id must still be peekable — validating again must
    // not have consumed it.
    await supertest(app.getHttpServer())
      .get(`/api/v1/backup/validate/${first.body.staging_id}/errors.csv`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
  });

  it("returns 404 for another user's staging_id, even within the same tenant", async () => {
    const upload = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', THREE_ERRORS_XLSX, 'three-errors.xlsx')
      .expect(201);

    await supertest(app.getHttpServer())
      .get(`/api/v1/backup/validate/${upload.body.staging_id}/errors.csv`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(404);
  });

  it('returns the error list as an injection-guarded, BOM-prefixed CSV', async () => {
    const upload = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', THREE_ERRORS_XLSX, 'three-errors.xlsx')
      .expect(201);

    const csvRes = await supertest(app.getHttpServer())
      .get(`/api/v1/backup/validate/${upload.body.staging_id}/errors.csv`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);

    const text = csvRes.text as string;
    // UTF-8 BOM: without it Excel on Windows decodes the file with the
    // system code page and mangles Bangla values.
    expect(text.startsWith('\uFEFF')).toBe(true);

    const lines = text
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\r\n');
    expect(lines[0]).toBe('"tab","row","column","severity","message","value"');
    // Header + 3 errors. Warnings are appended after them, so assert the
    // error lines are present rather than pinning the total.
    expect(lines.length).toBeGreaterThanOrEqual(4);

    // Every cell is quoted, and nothing starts a bare formula.
    for (const line of lines) {
      expect(line.startsWith('"')).toBe(true);
      expect(/(^|,)=/.test(line)).toBe(false);
    }
  });

  it('rejects a non-.xlsx file with 400', async () => {
    await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', Buffer.from('not an xlsx'), 'notes.txt')
      .expect(400);
  });

  it('refuses a TEACHER at the RolesGuard with the exact role message', async () => {
    // Pinning the status and message, not `[401, 403]`: RolesGuard runs
    // before PermissionsGuard here, so a guard-order or role-list regression
    // would still satisfy the looser assertion.
    await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .attach('file', VALID_XLSX, 'valid.xlsx')
      .expect(401)
      .expect(({ body }) => {
        expect(body.message).toBe('Requires one of roles: ADMIN, SUPER_ADMIN');
      });
  });
});
