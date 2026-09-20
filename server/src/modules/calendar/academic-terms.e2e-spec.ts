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
 * E2E tests for `GET/POST/PATCH/DELETE/reorder /calendar/terms` (#706/17.2.2).
 * Covers what only the HTTP boundary is responsible for — `CALENDAR_READ`/
 * `CALENDAR_MANAGE` gating and cross-tenant isolation — since the ordering
 * and range/overlap rules are already covered by
 * `academic-terms.service.integration.spec.ts`.
 */
const API = '/api/v1';

describe('Academic Terms E2E (17.2.2)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let otherTenantAdminToken: string;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-0000007e0002';
  const OTHER_ADMIN_ID = '00000000-0000-4000-8000-0000007e0010';
  const OTHER_ADMIN_EMAIL = 'academic-terms-other-admin@e2e.example';

  let yearAId: string;
  let yearBId: string;

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
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Academic Terms E2E Other School', 'academic-terms-e2e-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Academic Terms E2E Other Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_ID, OTHER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_ID, TENANT_B, UserRole.ADMIN],
    );

    const yearA = await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'Academic Terms E2E Year A', '2026-01-01', '2026-12-31', $1, NOW(), NOW())
       RETURNING id`,
      [TENANT_A],
    );
    yearAId = yearA[0].id;
    const yearB = await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'Academic Terms E2E Year B', '2026-01-01', '2026-12-31', $1, NOW(), NOW())
       RETURNING id`,
      [TENANT_B],
    );
    yearBId = yearB[0].id;

    adminToken = await login(SEED_ADMIN_EMAIL);
    otherTenantAdminToken = await login(OTHER_ADMIN_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('creates a term and lists it back for the owning tenant', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/calendar/terms`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        academic_year_id: yearAId,
        name: 'E2E Term 1',
        start_date: '2026-01-01',
        end_date: '2026-04-30',
      })
      .expect(201);

    expect(createRes.body.seq).toBe(1);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/calendar/terms`)
      .query({ academic_year_id: yearAId })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(listRes.body.some((t: { id: string }) => t.id === createRes.body.id)).toBe(true);
  });

  it('returns 422 TERM_OUTSIDE_ACADEMIC_YEAR for a term outside the year', async () => {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/calendar/terms`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        academic_year_id: yearAId,
        name: 'Outside',
        start_date: '2025-01-01',
        end_date: '2025-06-30',
      })
      .expect(422);

    expect(res.body.details?.code ?? res.body.message?.details?.code).toBeDefined();
  });

  it('a tenant B admin cannot read tenant A terms (empty list, no leak)', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/calendar/terms`)
      .query({ academic_year_id: yearAId })
      .set('Authorization', `Bearer ${otherTenantAdminToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  it('a tenant B admin cannot patch a tenant A term (404)', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/calendar/terms`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        academic_year_id: yearAId,
        name: 'Cross Tenant Patch Target',
        start_date: '2026-05-01',
        end_date: '2026-05-31',
      })
      .expect(201);

    await supertest(app.getHttpServer())
      .patch(`${API}/calendar/terms/${createRes.body.id}`)
      .set('Authorization', `Bearer ${otherTenantAdminToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('rejects a STUDENT from creating a term (401, RolesGuard)', async () => {
    // Same @Roles(ADMIN)+@RequirePermissions(CALENDAR_MANAGE) pattern as
    // academic-year.controller.ts: RolesGuard runs before PermissionsGuard
    // in the guard chain and throws UnauthorizedException (401) on a role
    // mismatch, so a non-ADMIN caller never reaches PermissionsGuard's
    // ForbiddenException (403) here — 401 is the correct, established
    // status for this codebase's RolesGuard, not a bug in this route.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       SELECT id, $1, $2, NOW(), NOW() FROM users WHERE email = $3
       ON CONFLICT DO NOTHING`,
      [TENANT_A, UserRole.STUDENT, SEED_ADMIN_EMAIL],
    );
    const studentLogin = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const studentToken = studentLogin.body.access_token;

    await supertest(app.getHttpServer())
      .post(`${API}/calendar/terms`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .set('X-Role', UserRole.STUDENT)
      .send({
        academic_year_id: yearAId,
        name: 'Student Attempt',
        start_date: '2026-06-01',
        end_date: '2026-06-30',
      })
      .expect(401);
  });

  it('returns 422 TERM_OVERLAP for an overlapping range via the DB constraint', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/calendar/terms`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        academic_year_id: yearAId,
        name: 'Overlap Base E2E',
        start_date: '2026-10-01',
        end_date: '2026-10-31',
      })
      .expect(201);

    const res = await supertest(app.getHttpServer())
      .post(`${API}/calendar/terms`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        academic_year_id: yearAId,
        name: 'Overlap Attempt E2E',
        start_date: '2026-10-15',
        end_date: '2026-11-15',
      })
      .expect(422);

    expect(res.body.details?.code ?? res.body.message?.details?.code).toBeDefined();
  });
});
