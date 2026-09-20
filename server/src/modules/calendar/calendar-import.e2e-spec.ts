import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import { toCsvContent } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_USER_ID,
} from '@test/constants';
import { CALENDAR_IMPORT_COLUMNS } from './import/calendar-import-rows.util';

/**
 * E2E tests for `/calendar-import` (17.3.1) — covers what only the HTTP
 * boundary owns: `CALENDAR_MANAGE` gating (TEACHER denied) and the
 * multipart upload → validate → commit round trip. Reconciliation
 * (NEW/UPDATED/UNCHANGED/ERROR) and academic-year/class-name resolution
 * are already covered by `calendar-import.service.integration.spec.ts`.
 */
const API = '/api/v1';

describe('Calendar import E2E (17.3.1)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  function csvRow(row: Record<(typeof CALENDAR_IMPORT_COLUMNS)[number], string>): string {
    return toCsvContent([[...CALENDAR_IMPORT_COLUMNS], CALENDAR_IMPORT_COLUMNS.map((c) => row[c])]);
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

    // A second, TEACHER-only role for the seeded admin on the same
    // tenant — `(user_id, tenant_id, role)` is unique, not
    // `(user_id, tenant_id)`, so this coexists with the seeded ADMIN role
    // and `X-Role` picks between them per request.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('lets ADMIN (holds CALENDAR_MANAGE) download the .csv template', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/calendar-import/template`)
      .query({ format: 'csv' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('"type","name","start_date"');
  });

  // RolesGuard throws 401 (not 403) for a role that isn't in the route's
  // `@Roles` list — same convention every other `@Roles(UserRole.ADMIN)`
  // route in this codebase follows (see `context.guard.ts`'s
  // `RolesGuard.canActivate`).
  it('denies TEACHER (lacks CALENDAR_MANAGE)', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/calendar-import/template`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(401);

    await supertest(app.getHttpServer())
      .post(`${API}/calendar-import/commit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({ staging_id: '00000000-0000-4000-8000-000000000000' })
      .expect(401);
  });

  it('rejects a validate call with no file', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/calendar-import/validate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(400);
  });

  it('validates a .csv upload, stages it, and commits it as a draft', async () => {
    const csv = csvRow({
      type: 'EVENT',
      name: 'E2E Import Event',
      start_date: '2031-09-01',
      end_date: '2031-09-01',
      start_time: '',
      end_time: '',
      counts_as_working_day: 'TRUE',
      audience: 'ALL',
      classes: '',
      description: '',
    });

    await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'Calendar Import E2E Year', '2031-01-01', '2031-12-31', $1, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_ID],
    );

    const validateRes = await supertest(app.getHttpServer())
      .post(`${API}/calendar-import/validate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .attach('file', Buffer.from(csv, 'utf8'), 'import.csv')
      .expect(201);

    expect(validateRes.body.summary.new).toBe(1);
    expect(validateRes.body.rows).toHaveLength(1);

    const commitRes = await supertest(app.getHttpServer())
      .post(`${API}/calendar-import/commit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ staging_id: validateRes.body.staging_id, publish: false })
      .expect(201);

    expect(commitRes.body).toEqual({ created: 1, updated: 0, unchanged: 0, failed: [] });
  });
});
