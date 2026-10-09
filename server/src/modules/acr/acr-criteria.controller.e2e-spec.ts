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
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** E2E for [28.2.1] `/acr/criteria`: RBAC, copy-on-write versions, audit row, tenant isolation. */
const API = '/api/v1';
const TENANT_A = SEED_TENANT_ID;
const TENANT_B = '00000000-0000-4000-8000-000000000a28';
const TEACHER_USER_ID = '00000000-0000-4000-8000-000000000a29';
const TEACHER_EMAIL = 'acr-criteria-e2e-teacher@testschool.example';

const row = (code: string, sort_order = 1) => ({
  block: 'BLOCK_2',
  code,
  label_en: `Label ${code}`,
  label_bn: `লেবেল ${code}`,
  sort_order,
});

describe('ACR criteria E2E (28.2.1)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;

  const login = async (email: string, password: string) =>
    (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password })
        .expect(200)
    ).body.access_token as string;

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
       VALUES ($1, 'ACR Criteria E2E Tenant B', 'acr-criteria-e2e-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACR Criteria E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_A, UserRole.TEACHER],
    );
    adminToken = await login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
    teacherToken = await login(TEACHER_EMAIL, SEED_ADMIN_PASSWORD);
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM acr_criteria WHERE tenant_id IN ($1, $2)`, [
      TENANT_A,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM acr_form_versions WHERE tenant_id IN ($1, $2)`, [
      TENANT_A,
      TENANT_B,
    ]);
    // `audit_logs` is append-only — no cleanup.
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
      SEED_ADMIN_USER_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1`, [TEACHER_USER_ID]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [TEACHER_USER_ID]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await app.close();
  });

  const as = (token: string, tenant: string, method: 'get' | 'put') =>
    supertest(app.getHttpServer())
      [method](`${API}/acr/criteria`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);

  it('forbids a TEACHER (403 from PermissionsGuard) on read and write', async () => {
    await as(teacherToken, TENANT_A, 'get').expect(403);
    await as(teacherToken, TENANT_A, 'put')
      .send({ criteria: [row('x')] })
      .expect(403);
  });

  it('ADMIN saves v1 then v2; GET returns latest; audit row written', async () => {
    const empty = await as(adminToken, TENANT_A, 'get').expect(200);
    expect(empty.body.version).toBe(0);

    const v1 = await as(adminToken, TENANT_A, 'put')
      .send({ criteria: [row('a'), row('b', 2)] })
      .expect(200);
    expect(v1.body.version).toBe(1);
    const v2 = await as(adminToken, TENANT_A, 'put')
      .send({ criteria: [row('a')] })
      .expect(200);
    expect(v2.body.version).toBe(2);

    const latest = await as(adminToken, TENANT_A, 'get').expect(200);
    expect(latest.body.id).toBe(v2.body.id);
    expect(latest.body.criteria).toHaveLength(1);

    const oldRows = await dataSource.query(
      `SELECT count(*)::int AS n FROM acr_criteria WHERE form_version_id = $1`,
      [v1.body.id],
    );
    expect(oldRows[0].n).toBe(2);

    const audit = await dataSource.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE tenant_id = $1 AND entity_id = $2`,
      [TENANT_A, v2.body.id],
    );
    expect(audit[0].n).toBe(1);

    // D1: ?versionId reads that version's own criteria, not the latest.
    const old = await as(adminToken, TENANT_A, 'get').query({ versionId: v1.body.id }).expect(200);
    expect(old.body.version).toBe(1);
    expect(old.body.criteria).toHaveLength(2);
    // Other tenant: same id is a 404; teacher 403 first; malformed id 400.
    await as(adminToken, TENANT_B, 'get').query({ versionId: v1.body.id }).expect(404);
    await as(teacherToken, TENANT_A, 'get').query({ versionId: v1.body.id }).expect(403);
    await as(adminToken, TENANT_A, 'get').query({ versionId: 'not-a-uuid' }).expect(400);
  });

  it('rejects a malformed body (400)', async () => {
    await as(adminToken, TENANT_A, 'put')
      .send({ criteria: [{ ...row('x'), block: 'BLOCK_9' }] })
      .expect(400);
  });

  it('tenant B cannot read tenant A criteria', async () => {
    const res = await as(adminToken, TENANT_B, 'get').expect(200);
    expect(res.body).toEqual({ id: null, version: 0, criteria: [] });
  });
});
