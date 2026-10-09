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
} from '@test/constants';

/** E2E for [28.2.2] `/acr/assessments`: privacy (subject 404 + absent from register), RBAC, tenant isolation, 409. */
const API = '/api/v1';
const TENANT_A = SEED_TENANT_ID;
const TENANT_B = '00000000-0000-4000-8000-000000000b28';
const TEACHER_USER_ID = '00000000-0000-4000-8000-000000000b29';
const STAFF_USER_ID = '00000000-0000-4000-8000-000000000b2a';
const YEAR_ID = '00000000-0000-4000-8000-000000000b2b';
const TEACHER_EMAIL = 'acr-assess-e2e-teacher@testschool.example';
const STAFF_EMAIL = 'acr-assess-e2e-staff@testschool.example';

describe('ACR assessments E2E (28.2.2)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let teacherToken: string;
  let ownAcrId: string;

  const login = async (email: string, password: string) =>
    (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password })
        .expect(200)
    ).body.access_token as string;

  const req = (token: string, tenant: string, method: 'get' | 'post' | 'patch', path: string) =>
    supertest(app.getHttpServer())
      [method](`${API}/acr${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
  }, 60000);

  // test/setup.ts clears every acr_* table (and more) before each test, so the
  // whole fixture is rebuilt per test; inserts are idempotent.
  beforeEach(async () => {
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'ACR Assess E2E Tenant B', 'acr-assess-e2e-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );
    for (const [id, email, name, role] of [
      [TEACHER_USER_ID, TEACHER_EMAIL, 'ACR Assess Teacher', UserRole.TEACHER],
      [STAFF_USER_ID, STAFF_EMAIL, 'ACR Assess Staff', UserRole.TEACHER],
    ] as const) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH, name],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, TENANT_A, role],
      );
    }
    await ds.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, is_current, tenant_id, created_at, updated_at)
       VALUES ($1, 'ACR Assess E2E Year', '2099-01-01', '2099-12-31', false, $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [YEAR_ID, TENANT_A],
    );
    adminToken = await login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
    teacherToken = await login(TEACHER_EMAIL, SEED_ADMIN_PASSWORD);
    // Criteria: one version with one criterion so `start` works.
    await supertest(app.getHttpServer())
      .put(`${API}/acr/criteria`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        criteria: [{ block: 'BLOCK_2', code: 'a', label_en: 'A', label_bn: 'ক', sort_order: 1 }],
      })
      .expect(200);
    // The admin's OWN ACR, inserted directly (an admin can't start one for self via the API).
    const v = await ds.query(
      `SELECT id FROM acr_form_versions WHERE tenant_id = $1 ORDER BY version DESC LIMIT 1`,
      [TENANT_A],
    );
    const own = await ds.query(
      `INSERT INTO acr_assessments (tenant_id, user_id, academic_year_id, form_version_id, status, assessed_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'INCOMPLETE', $5, NOW(), NOW()) RETURNING id`,
      [TENANT_A, SEED_ADMIN_USER_ID, YEAR_ID, v[0].id, STAFF_USER_ID],
    );
    ownAcrId = own[0].id;
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM acr_scores WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    await ds.query(`DELETE FROM acr_assessments WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    await ds.query(`DELETE FROM acr_criteria WHERE tenant_id IN ($1, $2)`, [TENANT_A, TENANT_B]);
    await ds.query(`DELETE FROM acr_form_versions WHERE tenant_id IN ($1, $2)`, [
      TENANT_A,
      TENANT_B,
    ]);
    await ds.query(`DELETE FROM academic_years WHERE id = $1`, [YEAR_ID]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
      SEED_ADMIN_USER_ID,
      TENANT_B,
    ]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [
      [TEACHER_USER_ID, STAFF_USER_ID],
    ]);
    // audit_logs is append-only: deleting a user who logged in would fire the FK's
    // ON DELETE SET NULL against its trigger, so blank the accounts instead.
    await ds.query(
      `UPDATE users SET password_hash = NULL, email = NULL, status = 'INACTIVE' WHERE id = ANY($1)`,
      [[TEACHER_USER_ID, STAFF_USER_ID]],
    );
    await ds.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await app.close();
  });

  it('forbids a TEACHER (403 from PermissionsGuard) on read and write', async () => {
    await req(teacherToken, TENANT_A, 'get', '/assessments').expect(403);
    await req(teacherToken, TENANT_A, 'post', '/assessments')
      .send({ user_id: STAFF_USER_ID, academic_year_id: YEAR_ID })
      .expect(403);
  });

  it('subject gets 404 on own ACR by every route and is absent from the register', async () => {
    const exists = await ds.query(`SELECT 1 FROM acr_assessments WHERE id = $1`, [ownAcrId]);
    expect(exists).toHaveLength(1);
    await req(adminToken, TENANT_A, 'get', `/assessments/${ownAcrId}`).expect(404);
    await req(adminToken, TENANT_A, 'patch', `/assessments/${ownAcrId}`).send({}).expect(404);
    await req(adminToken, TENANT_A, 'post', `/assessments/${ownAcrId}/complete`).expect(404);
    await req(adminToken, TENANT_A, 'post', `/assessments/${ownAcrId}/reopen`).expect(404);
    await req(adminToken, TENANT_A, 'get', `/staff/${SEED_ADMIN_USER_ID}`).expect(404);
    const reg = await req(adminToken, TENANT_A, 'get', '/assessments').expect(200);
    expect(reg.body.map((r: { id: string }) => r.id)).not.toContain(ownAcrId);
  });

  it('rejects a non-staff (guardian) target with 400', async () => {
    await ds.query(`UPDATE user_tenants SET role = $3 WHERE user_id = $1 AND tenant_id = $2`, [
      STAFF_USER_ID,
      TENANT_A,
      UserRole.PARENT,
    ]);
    try {
      await req(adminToken, TENANT_A, 'post', '/assessments')
        .send({ user_id: STAFF_USER_ID, academic_year_id: YEAR_ID })
        .expect(400);
    } finally {
      await ds.query(`UPDATE user_tenants SET role = $3 WHERE user_id = $1 AND tenant_id = $2`, [
        STAFF_USER_ID,
        TENANT_A,
        UserRole.TEACHER,
      ]);
    }
  });

  it('start -> score -> complete -> reopen; total server-side; duplicate 409; cross-tenant 404', async () => {
    const started = await req(adminToken, TENANT_A, 'post', '/assessments')
      .send({ user_id: STAFF_USER_ID, academic_year_id: YEAR_ID })
      .expect(201);
    const id = started.body.id as string;
    expect(started.body.status).toBe('INCOMPLETE');

    await req(adminToken, TENANT_A, 'post', '/assessments')
      .send({ user_id: STAFF_USER_ID, academic_year_id: YEAR_ID })
      .expect(409);

    // client-sent total is rejected by the whitelist validation
    await req(adminToken, TENANT_A, 'patch', `/assessments/${id}`).send({ total: 99 }).expect(400);

    const crit = await ds.query(`SELECT id FROM acr_criteria WHERE form_version_id = $1`, [
      started.body.form_version_id,
    ]);
    await req(adminToken, TENANT_A, 'post', `/assessments/${id}/complete`).expect(400);
    await req(adminToken, TENANT_A, 'patch', `/assessments/${id}`)
      .send({ scores: [{ criterion_id: crit[0].id, score: 5 }] })
      .expect(400);
    const patched = await req(adminToken, TENANT_A, 'patch', `/assessments/${id}`)
      .send({ scores: [{ criterion_id: crit[0].id, score: 3 }] })
      .expect(200);
    expect(patched.body.total).toBe(3);

    const done = await req(adminToken, TENANT_A, 'post', `/assessments/${id}/complete`).expect(201);
    expect(done.body.status).toBe('COMPLETED');
    await req(adminToken, TENANT_A, 'patch', `/assessments/${id}`).send({}).expect(409);
    await req(adminToken, TENANT_A, 'post', `/assessments/${id}/reopen`).expect(201);

    const audit = await ds.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2`,
      [TENANT_A, id],
    );
    expect(audit[0].n).toBe(2);
    const leaked = await ds.query(
      `SELECT 1 FROM audit_logs WHERE entity_id = $1 AND (new_values::text LIKE '%total%' OR old_values::text LIKE '%total%')`,
      [id],
    );
    expect(leaked).toHaveLength(0);

    await req(adminToken, TENANT_B, 'get', `/assessments/${id}`).expect(404);
    const reg = await req(adminToken, TENANT_A, 'get', `/assessments?year=${YEAR_ID}`).expect(200);
    expect(reg.body.map((r: { id: string }) => r.id)).toContain(id);
  });

  it('D1: an ACR keeps its criteria version after a newer one is saved, and still completes', async () => {
    // The per-test fixture saved criteria 'a'; start the ACR on that version.
    const started = await req(adminToken, TENANT_A, 'post', '/assessments')
      .send({ user_id: STAFF_USER_ID, academic_year_id: YEAR_ID })
      .expect(201);
    const id = started.body.id as string;
    const v1 = started.body.form_version_id as string;
    await supertest(app.getHttpServer())
      .put(`${API}/acr/criteria`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        criteria: [{ block: 'BLOCK_2', code: 'b', label_en: 'B', label_bn: 'খ', sort_order: 1 }],
      })
      .expect(200);

    const crit = (q: string) =>
      supertest(app.getHttpServer())
        .get(`${API}/acr/criteria${q}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_A)
        .expect(200);
    const own = await crit(`?versionId=${v1}`);
    expect(own.body.criteria.map((c: { code: string }) => c.code)).toEqual(['a']);
    expect((await crit('')).body.criteria.map((c: { code: string }) => c.code)).toEqual(['b']);

    const got = await req(adminToken, TENANT_A, 'get', `/assessments/${id}`).expect(200);
    expect(got.body.form_version_id).toBe(v1);
    // Complete needs only v1's criterion scored, even though the latest set has a different one.
    await req(adminToken, TENANT_A, 'patch', `/assessments/${id}`)
      .send({ scores: [{ criterion_id: own.body.criteria[0].id, score: 4 }] })
      .expect(200);
    await req(adminToken, TENANT_A, 'post', `/assessments/${id}/complete`).expect(201);
  });
});
