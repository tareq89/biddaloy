import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_SECTION_1_ID,
} from '@test/constants';

/**
 * E2E coverage for `GET /search` (30.2.1): tenant isolation, permission
 * denial, missing/invalid `X-Tenant-ID`, and soft-deleted exclusion.
 *
 * `students`/`guardians`/`teachers`/`invoices`/`payments` are all
 * "transactional" tables under `test/reset-order.ts` — `test/setup.ts`'s
 * global `beforeEach` truncates them before *every* `it()`, not once per
 * file. Fixture rows for those tables are therefore (re)created in
 * `beforeEach` here, not `describe`-level `beforeAll` — a `beforeAll`
 * insert would be wiped before the first test body ever runs. `schools`/
 * `users`/`user_tenants` are reference tables (reset once per file), so
 * the tenant/user/token setup below stays in `beforeAll`.
 */

const API = '/api/v1';
const TENANT_A = SEED_TENANT_ID;
const TENANT_B = '00000000-0000-4000-8000-0000083a0002';
const TEACHER_USER_ID = '00000000-0000-4000-8000-0000083a0003';
const TEACHER_EMAIL = 'search-teacher@e2e.example';
const PARENT_USER_ID = '00000000-0000-4000-8000-0000083a0004';
const PARENT_EMAIL = 'search-parent@e2e.example';

describe('GET /search (30.2.1)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let parentToken: string;
  let studentAId: string;
  let softDeletedStudentId: string;

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
       VALUES ($1, 'search-e2e-tenant-b', 'search-e2e-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    // Real second membership for the same admin user — proves tenant
    // scoping at the service layer, not just ContextGuard's "has any
    // membership" check (same pattern as cross-tenant-access.e2e-spec.ts).
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Search E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_A, UserRole.TEACHER],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Search E2E Parent', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, TENANT_A, UserRole.PARENT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    teacherToken = await login(TEACHER_EMAIL);
    parentToken = await login(PARENT_EMAIL);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // A tenant-A student findable by a unique name, plus a soft-deleted
    // one that must never surface. Re-inserted every test because
    // `students` is a transactional table truncated before each `it()`.
    const studentRows = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, 'Search E2E Findable Student', 'SRE2E-0001', 9001, $1, 'SMS', 'ACTIVE', $2, NOW(), NOW())
       RETURNING id`,
      [SEED_SECTION_1_ID, TENANT_A],
    );
    studentAId = studentRows[0].id;

    const softDeletedRows = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, preferred_communication, enrollment_status, tenant_id, deleted_at, created_at, updated_at)
       VALUES (DEFAULT, 'Search E2E Deleted Student', 'SRE2E-0002', 9002, $1, 'SMS', 'ACTIVE', $2, NOW(), NOW(), NOW())
       RETURNING id`,
      [SEED_SECTION_1_ID, TENANT_A],
    );
    softDeletedStudentId = softDeletedRows[0].id;
  });

  it('finds a tenant-A student by name for an ADMIN in tenant A', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'Search E2E Findable' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(res.body.students.map((s: { id: string }) => s.id)).toContain(studentAId);
  });

  it('tenant isolation: same admin querying from tenant B finds nothing from tenant A', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'Search E2E Findable' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_B)
      .expect(200);

    expect(res.body.students).toEqual([]);
  });

  it('excludes a soft-deleted student from results', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'Search E2E Deleted' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(res.body.students).toEqual([]);
  });

  it('permission denial: PARENT/STUDENT roles are refused the whole route (RolesGuard narrows below STUDENT_READ)', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'anything' })
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(401);

    // Prove RolesGuard's role-narrowing fired specifically, not some other
    // 401 path (e.g. a missing/invalid X-Tenant-ID) that also returns 401.
    expect(res.body.message).toContain('Requires one of roles');
  });

  it('permission denial: TEACHER (no INVOICE_READ/PAYMENT_READ) gets no invoices/payments key but does get students', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'Search E2E Findable' })
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(res.body).not.toHaveProperty('invoices');
    expect(res.body).not.toHaveProperty('payments');
    expect(res.body.students.map((s: { id: string }) => s.id)).toContain(studentAId);
  });

  it('returns 401 when X-Tenant-ID header is missing', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'anything' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
  });

  it('returns 401 with an invalid X-Tenant-ID (not a membership the caller holds)', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'anything' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000fff')
      .expect(401);
  });

  it('caps limit at 10 and rejects a non-integer limit', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'anything', limit: 999 })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(400);

    await supertest(app.getHttpServer())
      .get(`${API}/search`)
      .query({ q: 'anything', limit: 'abc' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(400);
  });
});
