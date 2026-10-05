import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { StorageService } from '../../storage/storage.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { ALL_TABS } from '../codec/registry';
import { SCHEMA_VERSION } from '../codec/meta';
import { writeWorkbook } from '../codec/workbook-codec';
import { STARTER_TABS } from './template.constants';

vi.setConfig({ testTimeout: 60_000 });

const FRESH_TENANT_ID = '00000000-0000-4000-8000-0000001e0301';
const FRESH_ADMIN_ID = '00000000-0000-4000-8000-0000001e0302';
const FRESH_ADMIN_EMAIL = 'admin@starter-e2e.example';
const FRESH_SCHOOL_NAME = 'Starter E2E School';

/** In-memory storage: the restore round trip needs a working put/get/delete. */
class FakeStorageService {
  private readonly objects = new Map<string, Buffer>();
  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }
  async get(key: string): Promise<{ body: Readable; contentType: string }> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`no object at "${key}"`);
    return { body: Readable.from([body]), contentType: 'application/octet-stream' };
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** [13.3.3] the `variant=starter` template. */
describe('starter template E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let freshAdminToken: string;

  const parseBuffer = (response: any, callback: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  async function download(query: string): Promise<Buffer> {
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/backup/template${query}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .buffer()
      .parse(parseBuffer)
      .expect(200);
    return res.body as Buffer;
  }

  async function validate(file: Buffer, token: string, tenantId: string) {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/backup/validate')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId)
      .attach('file', file, 'workbook.xlsx')
      .expect(201);
    return res.body;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useValue(new FakeStorageService())
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, $2, 'starter-e2e-school', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [FRESH_TENANT_ID, FRESH_SCHOOL_NAME],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Starter E2E Admin', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [FRESH_ADMIN_ID, FRESH_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [FRESH_ADMIN_ID, FRESH_TENANT_ID, UserRole.ADMIN],
    );

    const loginAs = async (email: string) =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    adminToken = await loginAs(SEED_ADMIN_EMAIL);
    freshAdminToken = await loginAs(FRESH_ADMIN_EMAIL);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('starter template has exactly the five starter sheets; the full one is unchanged', async () => {
    const starter = await validate(await download('?variant=starter'), adminToken, SEED_TENANT_ID);
    const presentStarter = (starter.tabs as { name: string; present: boolean }[])
      .filter((t) => t.present)
      .map((t) => t.name);
    expect(presentStarter).toEqual([...STARTER_TABS]);

    const full = await validate(await download(''), adminToken, SEED_TENANT_ID);
    const presentFull = (full.tabs as { present: boolean }[]).filter((t) => t.present).length;
    expect(presentFull).toBe(ALL_TABS.length);
  });

  it('rejects an unknown variant', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/backup/template?variant=tiny')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(400);
  });

  it('a filled starter file validates and restores, creating the rows', async () => {
    const yearId = randomUUID();
    const subjectId = randomUUID();
    const tabs = ALL_TABS.filter((t) => (STARTER_TABS as readonly string[]).includes(t.name));
    const file = await writeWorkbook({
      tabs,
      meta: {
        schema_version: SCHEMA_VERSION,
        kind: 'TEMPLATE',
        exported_at: new Date().toISOString(),
        app_version: 'test',
        source_school_name: FRESH_SCHOOL_NAME,
        source_school_slug: 'starter-e2e-school',
      },
      rowsFor: async function* (tab) {
        if (tab.name === 'academic_years') {
          yield {
            id: yearId,
            name: '2027',
            start_date: '2027-01-01',
            end_date: '2027-12-31',
            is_current: true,
          };
        }
        if (tab.name === 'subjects') {
          yield { id: subjectId, code: 'BAN', name_en: 'Bangla', name_bn: null, is_active: true };
        }
      },
    });

    const validated = await validate(file, freshAdminToken, FRESH_TENANT_ID);
    expect(validated.errors).toEqual([]);
    expect(validated.totals.creates).toBe(2);
    expect(validated.totals.deletes).toBe(0);

    const restore = await supertest(app.getHttpServer())
      .post('/api/v1/backup/restore')
      .set('Authorization', `Bearer ${freshAdminToken}`)
      .set('X-Tenant-ID', FRESH_TENANT_ID)
      .send({ staging_id: validated.staging_id, confirmation: FRESH_SCHOOL_NAME })
      .expect(202);

    const deadline = Date.now() + 45_000;
    let status = '';
    do {
      const job = await supertest(app.getHttpServer())
        .get(`/api/v1/backup/jobs/${restore.body.job_id}`)
        .set('Authorization', `Bearer ${freshAdminToken}`)
        .set('X-Tenant-ID', FRESH_TENANT_ID)
        .expect(200);
      status = job.body.status;
      if (status === 'DONE' || status === 'FAILED') break;
      await new Promise((r) => setTimeout(r, 500));
    } while (Date.now() < deadline);

    expect(status).toBe('DONE');
    const years = await dataSource.query(`SELECT name FROM academic_years WHERE tenant_id = $1`, [
      FRESH_TENANT_ID,
    ]);
    const subjects = await dataSource.query(`SELECT code FROM subjects WHERE tenant_id = $1`, [
      FRESH_TENANT_ID,
    ]);
    expect(years).toEqual([{ name: '2027' }]);
    expect(subjects).toEqual([{ code: 'BAN' }]);
  });
});
