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
  SEED_ADMIN_USER_ID,
} from '@test/constants';

/**
 * E2E tests for `/calendar/export` and `/calendar/clone` (17.3.2) — what
 * only the HTTP boundary owns: role/permission gating and cross-tenant
 * rejection. Export-round-trip and clone shift/drop/reconcile logic are
 * covered by `calendar-export.service.integration.spec.ts`.
 */
const API = '/api/v1';

describe('Calendar export/clone E2E (17.3.2)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000097';
  let academicYearId: string;
  let otherTenantYearId: string;

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
    // tenant — mirrors `calendar-import.e2e-spec.ts`'s pattern for
    // testing role denial without a second user.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    const yearRes = await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'Calendar Export E2E Year', '2031-01-01', '2031-12-31', $1, NOW(), NOW())
       RETURNING id`,
      [TENANT_ID],
    );
    academicYearId = yearRes[0].id;

    // A second tenant, with a membership for the seeded admin, so a
    // cross-tenant request reaches `CalendarExportService` and gets
    // rejected there (404 tenant scoping), not by `ContextGuard`
    // (401 not-a-member) — same reasoning as
    // `calendar-events.e2e-spec.ts`'s cross-tenant fixture.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ('${OTHER_TENANT_ID}', 'Calendar Export Other School', 'calendar-export-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${OTHER_TENANT_ID}', '${UserRole.ADMIN}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const otherYearRes = await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'Other Tenant Year', '2031-01-01', '2031-12-31', '${OTHER_TENANT_ID}', NOW(), NOW())
       RETURNING id`,
    );
    otherTenantYearId = otherYearRes[0].id;

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('lets ADMIN (holds CALENDAR_READ) export the calendar as .csv', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/calendar/export`)
      .query({ academic_year_id: academicYearId, format: 'csv' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('"type","name","start_date"');
  });

  it('rejects export of an academic year id belonging to another tenant', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/calendar/export`)
      .query({ academic_year_id: otherTenantYearId, format: 'csv' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(404);
  });

  it('denies TEACHER (lacks CALENDAR_MANAGE) from cloning', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/calendar/clone`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .send({ source_year_id: academicYearId, target_year_id: academicYearId })
      .expect(401);
  });

  it('rejects a clone whose target_year_id belongs to another tenant', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/calendar/clone`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ source_year_id: academicYearId, target_year_id: otherTenantYearId })
      .expect(404);
  });

  it('clones an ADMIN-owned year into a staged import, ready for /calendar-import/commit', async () => {
    const targetYearRes = await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'Clone Target E2E Year', '2032-01-01', '2032-12-31', $1, NOW(), NOW())
       RETURNING id`,
      [TENANT_ID],
    );
    const targetYearId = targetYearRes[0].id;

    await dataSource.query(
      `INSERT INTO calendar_events
         (id, tenant_id, academic_year_id, type, name, start_date, end_date, counts_as_working_day, audience, published_at, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'EXAM', 'Clone E2E Exam', '2031-06-01', '2031-06-01', true, 'ALL', NOW(), NOW(), NOW())`,
      [TENANT_ID, academicYearId],
    );

    const cloneRes = await supertest(app.getHttpServer())
      .post(`${API}/calendar/clone`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ source_year_id: academicYearId, target_year_id: targetYearId })
      .expect(201);

    expect(cloneRes.body.summary.new).toBeGreaterThanOrEqual(1);
    expect(typeof cloneRes.body.staging_id).toBe('string');

    const commitRes = await supertest(app.getHttpServer())
      .post(`${API}/calendar-import/commit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ staging_id: cloneRes.body.staging_id, publish: false })
      .expect(201);

    expect(commitRes.body.created).toBeGreaterThanOrEqual(1);
  });
});
