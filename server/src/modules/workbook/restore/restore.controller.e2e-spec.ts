import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { StorageService } from '../../storage/storage.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { writeWorkbook } from '../codec/workbook-codec';
import { SCHEMA_VERSION } from '../codec/meta';
import { schoolTab } from '../tabs/school/school.tab';
import { usersTab } from '../tabs/people/users.tab';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

const FIXTURES_DIR = join(__dirname, '../../../../test/fixtures/workbook');
const VALID_XLSX = readFileSync(join(FIXTURES_DIR, 'valid.xlsx'));

const TEACHER_USER_ID = '00000000-0000-4000-8000-000000060901';
const TEACHER_EMAIL = 'teacher@restore-e2e.example';

const FRESH_TENANT_ID = '00000000-0000-4000-8000-000000060902';
const FRESH_SCHOOL_NAME = 'Restore E2E Fresh School';
const FRESH_ADMIN_USER_ID = '00000000-0000-4000-8000-000000060903';
const FRESH_ADMIN_EMAIL = 'admin@restore-e2e-fresh.example';

// A second empty school, used only by the AUTH-02 repro below.
const JOIN_TENANT_ID = '00000000-0000-4000-8000-000000060904';
const JOIN_SCHOOL_NAME = 'Restore E2E Join School';
const JOIN_ADMIN_USER_ID = '00000000-0000-4000-8000-000000060905';
const JOIN_ADMIN_EMAIL = 'admin@restore-e2e-join.example';

/** In-memory stand-in for `StorageService` — no S3 is guaranteed
 * reachable in this e2e environment (same reasoning as
 * `workbook.controller.e2e-spec.ts`), and the restore round trip actually
 * needs a working `put`/`get`/`delete` (the snapshot write, the staged
 * upload write, and the processor re-reading it), not just a `get` stub. */
class FakeStorageService {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }

  async get(key: string): Promise<{ body: Readable; contentType: string }> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`FakeStorageService: no object at "${key}"`);
    return { body: Readable.from([body]), contentType: 'application/octet-stream' };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/**
 * E2E tests for `POST /backup/restore` (#609). Covers the guard/role
 * matrix, the 400/404/409 error translations from `RestoreService`
 * (#607), and the full happy path — validate, restore, poll
 * `GET /backup/jobs/:id` to DONE, verifying it exposes `progress`,
 * `failed_tab` and `snapshot_job_id`.
 */
describe('POST /backup/restore E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let freshAdminToken: string;
  let schoolName: string;

  const TENANT_ID = SEED_TENANT_ID;

  async function validateWorkbook(tenantId: string, token: string, file: Buffer): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId)
      .set('X-Role', UserRole.ADMIN)
      .attach('file', file, 'workbook.xlsx')
      .expect(201);
    return res.body.staging_id as string;
  }

  /** Builds a real `.xlsx` containing only the `school` tab's single row
   * for `tenantId` — mirrors `restore.integration.spec.ts`'s `buildWorkbook`
   * helper. Used only against `FRESH_TENANT_ID`, which starts with zero
   * rows anywhere: the pre-restore SNAPSHOT step exports the tenant's
   * *current* DB state before the upload is even read, and a tenant with
   * academic/fee/people data currently trips the export path's
   * `ExportContext.keyOf` TODO (see the return note) — an unrelated,
   * already-known gap this ticket's territory (`restore/**`) cannot fix.
   * A brand-new, empty tenant has no rows in any FK-referencing tab, so
   * the snapshot export never reaches that code path and can actually
   * finish, letting this test observe a real DONE. */
  async function buildSchoolOnlyWorkbook(tenantId: string, name: string): Promise<Buffer> {
    return writeWorkbook({
      tabs: [schoolTab],
      meta: {
        schema_version: SCHEMA_VERSION,
        kind: 'BACKUP',
        exported_at: new Date().toISOString(),
        app_version: 'test',
        source_school_name: name,
        source_school_slug: 'restore-e2e-fresh',
      },
      rowsFor: async function* (tab) {
        if (tab.name === 'school') {
          yield {
            id: tenantId,
            name,
            name_bn: null,
            address: null,
            phone: null,
            email: null,
            registration_id: null,
            settings: null,
          };
        }
      },
    });
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
      .overrideProvider(StorageService)
      .useValue(new FakeStorageService())
      .compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      ['00000000-0000-4000-8000-000000000010', TENANT_ID, UserRole.ADMIN],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Restore E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    // A brand-new, otherwise-empty tenant — see `buildSchoolOnlyWorkbook`'s
    // doc comment for why the happy path runs against this one, not the
    // seeded `SEED_TENANT_ID`.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, $2, 'restore-e2e-fresh-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [FRESH_TENANT_ID, FRESH_SCHOOL_NAME],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Restore E2E Fresh Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [FRESH_ADMIN_USER_ID, FRESH_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [FRESH_ADMIN_USER_ID, FRESH_TENANT_ID, UserRole.ADMIN],
    );

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, $2, 'restore-e2e-join-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [JOIN_TENANT_ID, JOIN_SCHOOL_NAME],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Restore E2E Join Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [JOIN_ADMIN_USER_ID, JOIN_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [JOIN_ADMIN_USER_ID, JOIN_TENANT_ID, UserRole.ADMIN],
    );

    const nameRows = await dataSource.query(`SELECT name FROM schools WHERE id = $1`, [TENANT_ID]);
    schoolName = nameRows[0].name;

    const loginAs = async (email: string) => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token as string;
    };

    adminToken = await loginAs(SEED_ADMIN_EMAIL);
    teacherToken = await loginAs(TEACHER_EMAIL);
    freshAdminToken = await loginAs(FRESH_ADMIN_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects TEACHER with 403 (permission guard)', async () => {
    await supertest(app.getHttpServer())
      .post('/api/v1/backup/restore')
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ staging_id: randomUUID(), confirmation: 'anything' })
      .expect(403);
  });

  it('returns 400 and creates no job when the confirmation phrase is wrong', async () => {
    const stagingId = await validateWorkbook(TENANT_ID, adminToken, VALID_XLSX);

    await supertest(app.getHttpServer())
      .post('/api/v1/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ staging_id: stagingId, confirmation: 'definitely-not-the-school-name' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.message).toBe('Confirmation text does not match.');
      });

    const rows = await dataSource.query(
      `SELECT id FROM workbook_jobs WHERE tenant_id = $1 AND kind = 'RESTORE' AND staging_id = $2`,
      [TENANT_ID, stagingId],
    );
    expect(rows).toHaveLength(0);
  });

  it('returns 404 for an unknown or expired staging_id', async () => {
    await supertest(app.getHttpServer())
      .post('/api/v1/backup/restore')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ staging_id: randomUUID(), confirmation: schoolName })
      .expect(404)
      .expect(({ body }) => {
        expect(body.message).toBe('Staged import not found or expired.');
      });
  });

  it(
    'happy path: 202 with job_id + snapshot_job_id, rejects a concurrent restore with 423, ' +
      'then reaches DONE with progress/failed_tab/snapshot_job_id exposed',
    async () => {
      const workbook = await buildSchoolOnlyWorkbook(FRESH_TENANT_ID, FRESH_SCHOOL_NAME);
      const stagingId = await validateWorkbook(FRESH_TENANT_ID, freshAdminToken, workbook);

      // Staged up front: once the first restore holds the lock, every write to this school
      // (including /backup/validate) is refused with 423 (#2210).
      const secondStagingId = await validateWorkbook(
        FRESH_TENANT_ID,
        freshAdminToken,
        await buildSchoolOnlyWorkbook(FRESH_TENANT_ID, FRESH_SCHOOL_NAME),
      );

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/backup/restore')
        .set('Authorization', `Bearer ${freshAdminToken}`)
        .set('X-Tenant-ID', FRESH_TENANT_ID)
        .send({ staging_id: stagingId, confirmation: FRESH_SCHOOL_NAME })
        .expect(202);

      expect(res.body.job_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.snapshot_job_id).toMatch(/^[0-9a-f-]{36}$/);
      const { job_id: jobId, snapshot_job_id: snapshotJobId } = res.body;

      // A second restore for the same tenant, while the first still holds
      // the per-tenant lock, must be refused — even with a fresh staging_id.
      await supertest(app.getHttpServer())
        .post('/api/v1/backup/restore')
        .set('Authorization', `Bearer ${freshAdminToken}`)
        .set('X-Tenant-ID', FRESH_TENANT_ID)
        .send({ staging_id: secondStagingId, confirmation: FRESH_SCHOOL_NAME })
        .expect(423)
        .expect(({ body }) => {
          // The freeze guard (#2210) now refuses it before RestoreService's own 409 lock check.
          expect(body.details.code).toBe('TENANT_RESTORING');
        });

      // Poll GET /backup/jobs/:id until the restore reaches a terminal
      // status. Generous budget: the flow waits on a real snapshot export
      // plus a real re-validate-and-apply pass through the BullMQ worker.
      const deadline = Date.now() + 60_000;
      let job: { status: string; progress: unknown; failed_tab: unknown; snapshot_job_id: string };
      do {
        const getRes = await supertest(app.getHttpServer())
          .get(`/api/v1/backup/jobs/${jobId}`)
          .set('Authorization', `Bearer ${freshAdminToken}`)
          .set('X-Tenant-ID', FRESH_TENANT_ID)
          .expect(200);
        job = getRes.body;
        if (job.status === 'DONE' || job.status === 'FAILED') break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      } while (Date.now() < deadline);

      expect(job.status).toBe('DONE');
      // These fields already existed on WorkbookJobDto (14.7.2) — this
      // just confirms a RESTORE job populates them the same way.
      expect(job.snapshot_job_id).toBe(snapshotJobId);
      expect('progress' in job).toBe(true);
      expect('failed_tab' in job).toBe(true);
    },
    90_000,
  );

  // AUTH-02: a restore that names another school's user must not make that user a member here.
  it('does not attach an existing account of another school; it only files a join request', async () => {
    const joinAdminToken = (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: JOIN_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;

    // TEACHER_EMAIL already belongs to the seeded school (a different tenant).
    const workbook = await writeWorkbook({
      tabs: [schoolTab, usersTab],
      meta: {
        schema_version: SCHEMA_VERSION,
        kind: 'BACKUP',
        exported_at: new Date().toISOString(),
        app_version: 'test',
        source_school_name: JOIN_SCHOOL_NAME,
        source_school_slug: 'restore-e2e-join',
      },
      rowsFor: async function* (tab) {
        if (tab.name === 'school') {
          yield {
            id: JOIN_TENANT_ID,
            name: JOIN_SCHOOL_NAME,
            name_bn: null,
            address: null,
            phone: null,
            email: null,
            registration_id: null,
            settings: null,
          };
        }
        if (tab.name === 'users') {
          yield {
            id: randomUUID(),
            email: TEACHER_EMAIL,
            phone: null,
            full_name: 'Restore E2E Teacher',
            role: UserRole.TEACHER,
          };
        }
      },
    });
    const stagingId = await validateWorkbook(JOIN_TENANT_ID, joinAdminToken, workbook);
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/backup/restore')
      .set('Authorization', `Bearer ${joinAdminToken}`)
      .set('X-Tenant-ID', JOIN_TENANT_ID)
      .send({ staging_id: stagingId, confirmation: JOIN_SCHOOL_NAME })
      .expect(202);

    const deadline = Date.now() + 60_000;
    let status = '';
    do {
      const getRes = await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${res.body.job_id}`)
        .set('Authorization', `Bearer ${joinAdminToken}`)
        .set('X-Tenant-ID', JOIN_TENANT_ID)
        .expect(200);
      status = getRes.body.status;
      if (status === 'DONE' || status === 'FAILED') break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (Date.now() < deadline);
    expect(status).toBe('DONE');

    const memberships = await dataSource.query(
      `SELECT 1 FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`,
      [TEACHER_USER_ID, JOIN_TENANT_ID],
    );
    expect(memberships).toHaveLength(0);

    const listed = await supertest(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${joinAdminToken}`)
      .set('X-Tenant-ID', JOIN_TENANT_ID)
      .expect(200);
    const emails = (listed.body.data ?? listed.body).map((u: { email: string }) => u.email);
    expect(emails).not.toContain(TEACHER_EMAIL);

    // Only after the owner accepts would a membership appear; the request is waiting.
    const requests = await dataSource.query(
      `SELECT 1 FROM auth_tokens WHERE user_id = $1 AND tenant_id = $2 AND purpose = 'JOIN_SCHOOL'`,
      [TEACHER_USER_ID, JOIN_TENANT_ID],
    );
    expect(requests).toHaveLength(1);
  }, 90_000);
});
