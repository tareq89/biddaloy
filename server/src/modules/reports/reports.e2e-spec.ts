import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * E2E coverage for `GET /reports/collections` and
 * `GET /reports/collections.csv` (16.6.2): permission gate (TEACHER
 * refused, ADMIN allowed) and the CSV export's header row.
 */

const API = '/api/v1';
const TEACHER_USER_ID = '00000000-0000-4000-8000-0000067c0001';
const TEACHER_EMAIL = 'collections-report-teacher@e2e.example';

describe('GET /reports/collections (16.6.2)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Collections Report Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, SEED_TENANT_ID, UserRole.TEACHER],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('refuses TEACHER (lacks REPORT_COLLECTIONS_READ)', async () => {
    // Codebase convention (see wallet.e2e-spec.ts, RolesGuard): a role not
    // listed in @Roles() fails before PermissionsGuard even runs, so this
    // is 401 (unauthorized), not 403 (forbidden) — consistent everywhere
    // else `@Roles` + `@RequirePermissions` are combined.
    await supertest(app.getHttpServer())
      .get(`${API}/reports/collections?from=2026-01-01&to=2026-01-31`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });

  it('allows ADMIN and returns the report shape', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/reports/collections?from=2026-01-01&to=2026-01-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    expect(res.body).toHaveProperty('range');
    expect(res.body).toHaveProperty('totals');
    expect(res.body).toHaveProperty('by_method');
    expect(res.body).toHaveProperty('by_collector');
    expect(res.body).toHaveProperty('by_fee_type');
    expect(res.body).toHaveProperty('by_day');
  });

  it('refuses TEACHER on the CSV export too', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/reports/collections.csv?from=2026-01-01&to=2026-01-31`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });

  it('CSV export has a header row and UTF-8 BOM', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/reports/collections.csv?from=2026-01-01&to=2026-01-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    const body: Buffer = res.body instanceof Buffer ? res.body : Buffer.from(res.text, 'utf-8');
    // UTF-8 BOM: EF BB BF
    expect(body[0]).toBe(0xef);
    expect(body[1]).toBe(0xbb);
    expect(body[2]).toBe(0xbf);
    const text = body.slice(3).toString('utf-8');
    const firstLine = text.split('\r\n')[0];
    expect(firstLine).toBe(
      '"Date","Invoice No","Student","Method","Reference","Collector","Amount","Discount","Reversal"',
    );
  });

  it('rejects a full ISO timestamp in `from`/`to` with 400, not a 500', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/reports/collections?from=2026-03-01T00:00:00Z&to=2026-03-31`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(400);
  });
});
