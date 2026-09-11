import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Readable } from 'stream';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { UserRole } from '@biddaloy/shared';
import { StorageService } from '../../storage/storage.service';
import { XLSX_MIME } from './export.constants';

/**
 * [14.7.2] E2E tests for:
 *   POST /backup/export
 *   GET  /backup/jobs
 *   GET  /backup/jobs/:id
 *   GET  /backup/jobs/:id/download
 *
 * Focus: permission/role guard both directions, tenant isolation, the
 * expired/never-expires 410 distinction (C3), the not-ready 409, and
 * byte-equal download.
 */
describe('Workbook Backup E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let superAdminToken: string;
  let teacherToken: string;
  let accountantToken: string;
  let otherTenantAdminToken: string;
  const FIXTURE_BYTES = Buffer.from('fake-xlsx-bytes-for-e2e');

  const TENANT_ID = SEED_TENANT_ID;
  const TEACHER_USER_ID = '00000000-0000-4000-8000-0000000c0b01';
  const TEACHER_EMAIL = 'teacher@backup-e2e.example';
  const ACCOUNTANT_USER_ID = '00000000-0000-4000-8000-0000000c0b02';
  const ACCOUNTANT_EMAIL = 'accountant@backup-e2e.example';
  const SUPER_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000c0b03';
  const SUPER_ADMIN_EMAIL = 'superadmin@backup-e2e.example';
  const OTHER_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000c0b04';
  const OTHER_ADMIN_EMAIL = 'admin@backup-e2e-other.example';
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c0b00';
  let seq = 0;

  async function insertJob(
    tenantId: string,
    overrides: {
      status?: string;
      expires_at?: string | null;
      storage_key?: string | null;
      size_bytes?: string | null;
    } = {},
  ): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO workbook_jobs (id, tenant_id, kind, status, source, requested_by_user_id, storage_key, size_bytes, pinned, expires_at, created_at)
       VALUES (DEFAULT, $1, 'EXPORT', $2, 'MANUAL', $3, $4, $5, false, $6, NOW())
       RETURNING id`,
      [
        tenantId,
        overrides.status ?? 'DONE',
        SEED_ADMIN_USER_ID,
        overrides.storage_key === undefined
          ? `tenants/${tenantId}/backups/fixture-${seq}.xlsx`
          : overrides.storage_key,
        overrides.size_bytes === undefined ? String(FIXTURE_BYTES.length) : overrides.size_bytes,
        overrides.expires_at === undefined ? null : overrides.expires_at,
      ],
    );
    return res[0].id;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // No S3/MinIO guaranteed reachable in this environment — stub
      // StorageService.get to return a known buffer as a Readable, per
      // the plan's fallback, so the byte-equality assertion still runs.
      .overrideProvider(StorageService)
      .useValue({
        get: async () => ({ body: Readable.from(FIXTURE_BYTES), contentType: XLSX_MIME }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other School', 'other-school-backup-e2e', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );

    // A TEACHER inside the caller tenant — authenticated, off @Roles and
    // without BACKUP_MANAGE.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Backup E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    // An ACCOUNTANT inside the caller tenant — a real staff role, still
    // lacks BACKUP_MANAGE.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Backup E2E Accountant', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, ACCOUNTANT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [ACCOUNTANT_USER_ID, TENANT_ID, UserRole.ACCOUNTANT],
    );

    // A SUPER_ADMIN inside the caller tenant.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Backup E2E Super Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, SUPER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, TENANT_ID, UserRole.SUPER_ADMIN],
    );

    // An ADMIN who belongs only to the other school.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Backup E2E Other Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_USER_ID, OTHER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );

    const loginAs = async (email: string) => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token as string;
    };

    adminToken = await loginAs(SEED_ADMIN_EMAIL);
    superAdminToken = await loginAs(SUPER_ADMIN_EMAIL);
    teacherToken = await loginAs(TEACHER_EMAIL);
    accountantToken = await loginAs(ACCOUNTANT_EMAIL);
    otherTenantAdminToken = await loginAs(OTHER_ADMIN_EMAIL);
  });

  afterAll(async () => {
    await app.close();
  });

  // POST /backup/export is deliberately excluded from this shared loop: it's
  // the only route behind STRICT_RATE_LIMIT (5 req/60s per IP via the global
  // ThrottlerGuard), and this loop alone fires 5 requests per route. Its own
  // guard behavior is covered in the 'POST /backup/export' describe block
  // below with a single request per case.
  const routes: Array<{ name: string; method: 'get' | 'post'; path: (id: string) => string }> = [
    { name: 'GET /backup/jobs', method: 'get', path: () => '/api/v1/backup/jobs' },
    { name: 'GET /backup/jobs/:id', method: 'get', path: (id) => `/api/v1/backup/jobs/${id}` },
    {
      name: 'GET /backup/jobs/:id/download',
      method: 'get',
      path: (id) => `/api/v1/backup/jobs/${id}/download`,
    },
  ];

  describe('permission and role guard', () => {
    for (const route of routes) {
      it(`${route.name} allows ADMIN`, async () => {
        const id = await insertJob(TENANT_ID);
        const res = await supertest(app.getHttpServer())
          [route.method](route.path(id))
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Tenant-ID', TENANT_ID);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      it(`${route.name} allows SUPER_ADMIN`, async () => {
        const id = await insertJob(TENANT_ID);
        const res = await supertest(app.getHttpServer())
          [route.method](route.path(id))
          .set('Authorization', `Bearer ${superAdminToken}`)
          .set('X-Tenant-ID', TENANT_ID);
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      // RolesGuard (@Roles(ADMIN, SUPER_ADMIN)) rejects a role outside that
      // list with 401 (see `RolesGuard.canActivate` — it throws
      // UnauthorizedException, not Forbidden, on a role mismatch), so
      // TEACHER and ACCOUNTANT never even reach PermissionsGuard here.
      it(`${route.name} rejects TEACHER with 401 (role guard)`, async () => {
        const id = await insertJob(TENANT_ID);
        await supertest(app.getHttpServer())
          [route.method](route.path(id))
          .set('Authorization', `Bearer ${teacherToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .expect(401);
      });

      it(`${route.name} rejects ACCOUNTANT with 401 (role guard, before permission check)`, async () => {
        const id = await insertJob(TENANT_ID);
        await supertest(app.getHttpServer())
          [route.method](route.path(id))
          .set('Authorization', `Bearer ${accountantToken}`)
          .set('X-Tenant-ID', TENANT_ID)
          .expect(401);
      });

      it(`${route.name} rejects no token with 401`, async () => {
        const id = await insertJob(TENANT_ID);
        await supertest(app.getHttpServer())[route.method](route.path(id)).expect(401);
      });
    }
  });

  describe('context header', () => {
    it('requires X-Tenant-ID', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/backup/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);
    });

    it('rejects a syntactically invalid X-Tenant-ID', async () => {
      // ContextGuard resolves membership from the header value; a value
      // that matches no membership is indistinguishable from a malformed
      // one and gets the same 401 (see `reminders.e2e-spec.ts`'s
      // "matches no school" case for the same convention).
      await supertest(app.getHttpServer())
        .get('/api/v1/backup/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', 'not-a-uuid')
        .expect(401);
    });
  });

  describe('tenant isolation', () => {
    it('a job under another tenant is invisible: 404 on get/download, absent from list', async () => {
      const otherJobId = await insertJob(OTHER_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${otherJobId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);

      await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${otherJobId}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);

      const listRes = await supertest(app.getHttpServer())
        .get('/api/v1/backup/jobs')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
      expect(listRes.body.data.map((j: { id: string }) => j.id)).not.toContain(otherJobId);
    });

    it("an admin of the other tenant cannot reach tenant A's job either", async () => {
      const jobId = await insertJob(TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${jobId}`)
        .set('Authorization', `Bearer ${otherTenantAdminToken}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID)
        .expect(404);
    });
  });

  describe('download status handling', () => {
    it('returns 410 when expires_at is in the past', async () => {
      const jobId = await insertJob(TENANT_ID, {
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      });

      await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${jobId}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(410);
    });

    it('does not 410 when expires_at is NULL (never expires) — proves C3', async () => {
      const jobId = await insertJob(TENANT_ID, { expires_at: null });

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${jobId}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID);

      expect(res.status).toBe(200);
    });

    it('returns 409 when the job is not ready (QUEUED)', async () => {
      const jobId = await insertJob(TENANT_ID, {
        status: 'QUEUED',
        storage_key: null,
        size_bytes: null,
      });

      await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${jobId}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(409);
    });

    it('streams bytes identical to storage and the correct xlsx content-type', async () => {
      const jobId = await insertJob(TENANT_ID);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${jobId}/download`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toBe(XLSX_MIME);
      expect(Buffer.compare(res.body as Buffer, FIXTURE_BYTES)).toBe(0);
    });
  });

  describe('POST /backup/export', () => {
    // Kept to a single guard-rejection request (rather than the full
    // TEACHER/ACCOUNTANT/no-token matrix used for the other routes) because
    // this route alone sits behind STRICT_RATE_LIMIT (5 req/60s per IP).
    it('rejects TEACHER with 401 (role guard, before permission check)', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/backup/export')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(401);
    });

    it('returns 202 with a uuid job_id and inserts a QUEUED row for the caller tenant', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/backup/export')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(202);

      expect(res.body.job_id).toMatch(/^[0-9a-f-]{36}$/);

      const rows = await dataSource.query(
        `SELECT status, tenant_id FROM workbook_jobs WHERE id = $1`,
        [res.body.job_id],
      );
      expect(rows).toHaveLength(1);
      // A real BullMQ worker is attached in this e2e environment, so the row
      // can already have moved past QUEUED to RUNNING (or finished) by the
      // time we read it back — assert it's in-flight, not the exact status.
      expect(['QUEUED', 'RUNNING', 'DONE']).toContain(rows[0].status);
      expect(rows[0].tenant_id).toBe(TENANT_ID);
    });
  });
});
