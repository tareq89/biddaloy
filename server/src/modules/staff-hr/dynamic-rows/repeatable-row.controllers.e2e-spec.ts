import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * E2E tests for [23.3]/[23.4]'s
 * `/staff/:userId/{family,address,experience,education,training,
 * achievement,language}` replace-on-save controllers: replace, then GET
 * returns exactly the new set — one `it` per controller, plus tenant
 * isolation on the family endpoint (same shape applies to the rest via the
 * shared base service).
 */
const API = '/api/v1';
const TENANT_A = SEED_TENANT_ID;
const TENANT_B = '00000000-0000-4000-8000-000000000301';
const STAFF_USER_ID = '00000000-0000-4000-8000-000000000302';
const STAFF_EMAIL = 'repeatable-row-e2e-staff@testschool.example';
const TENANT_B_USER_ID = '00000000-0000-4000-8000-000000000303';
const TENANT_B_EMAIL = 'repeatable-row-e2e-tenant-b-user@testschool.example';

describe('Staff HR repeatable-row E2E (23.3)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

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
       VALUES ($1, 'Repeatable Row E2E Tenant B', 'repeatable-row-e2e-tenant-b', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_B, UserRole.ADMIN],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Repeatable Row E2E Staff Member', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [STAFF_USER_ID, STAFF_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [STAFF_USER_ID, TENANT_A, UserRole.TEACHER],
    );

    // A genuine tenant-B-only user — proves a tenant-A admin can't attach
    // rows to a user who isn't a tenant-A member.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Repeatable Row E2E Tenant B User', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B_USER_ID, TENANT_B_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TENANT_B_USER_ID, TENANT_B, UserRole.TEACHER],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await dataSource.query(`DELETE FROM staff_family_members WHERE tenant_id IN ($1, $2)`, [
      TENANT_A,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM staff_addresses WHERE tenant_id = $1`, [TENANT_A]);
    await dataSource.query(`DELETE FROM staff_experience WHERE tenant_id = $1`, [TENANT_A]);
    await dataSource.query(`DELETE FROM staff_education WHERE tenant_id = $1`, [TENANT_A]);
    await dataSource.query(`DELETE FROM staff_training WHERE tenant_id = $1`, [TENANT_A]);
    await dataSource.query(`DELETE FROM staff_achievements WHERE tenant_id = $1`, [TENANT_A]);
    await dataSource.query(`DELETE FROM staff_languages WHERE tenant_id = $1`, [TENANT_A]);
    await dataSource.query(`DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`, [
      SEED_ADMIN_USER_ID,
      TENANT_B,
    ]);
    await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [
      [STAFF_USER_ID, TENANT_B_USER_ID],
    ]);
    await dataSource.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await app.close();
  });

  it('replaces family-member rows, then GET returns exactly the new set', async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/family`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ rows: [{ relation: 'Father', name: 'Old Name' }] })
      .expect(200);

    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/family`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        rows: [
          { relation: 'Father', name: 'New Father' },
          { relation: 'Mother', name: 'New Mother', occupation: 'Teacher' },
        ],
      })
      .expect(200);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/staff/${STAFF_USER_ID}/family`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(listRes.body).toHaveLength(2);
    expect(listRes.body.map((r: { name: string }) => r.name).sort()).toEqual([
      'New Father',
      'New Mother',
    ]);

    const [auditRow] = await dataSource.query(
      `SELECT * FROM audit_logs WHERE entity_type = 'StaffHrRecord' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [STAFF_USER_ID],
    );
    expect(auditRow).toBeTruthy();
  });

  it("rejects replacing rows for a user who isn't a member of the caller's tenant", async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${TENANT_B_USER_ID}/family`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ rows: [{ relation: 'Father', name: 'Should Not Save' }] })
      .expect(403);
  });

  it('replaces address rows, then GET returns exactly the new set', async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/address`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        rows: [
          { type: 'PRESENT', district: 'Dhaka' },
          { type: 'PERMANENT', district: 'Chattogram' },
        ],
      })
      .expect(200);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/staff/${STAFF_USER_ID}/address`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(listRes.body).toHaveLength(2);
    expect(listRes.body.map((r: { district: string }) => r.district).sort()).toEqual([
      'Chattogram',
      'Dhaka',
    ]);
  });

  it('replaces experience rows, then GET returns exactly the new set', async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/experience`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        rows: [{ institution: 'ABC School', designation: 'Teacher', from_date: '2020-01-01' }],
      })
      .expect(200);

    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/experience`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ rows: [] })
      .expect(200);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/staff/${STAFF_USER_ID}/experience`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(listRes.body).toHaveLength(0);
  });

  it('replaces education rows, then GET returns exactly the new set', async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/education`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        rows: [
          { degree: 'BSc', institution: 'ABC University', passing_year: '2015' },
          { degree: 'HSC', institution: 'XYZ College' },
        ],
      })
      .expect(200);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/staff/${STAFF_USER_ID}/education`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(listRes.body).toHaveLength(2);
    expect(listRes.body.map((r: { degree: string }) => r.degree).sort()).toEqual(['BSc', 'HSC']);
  });

  it('rejects replacing education rows for a user outside the caller tenant', async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${TENANT_B_USER_ID}/education`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ rows: [{ degree: 'BSc', institution: 'Should Not Save' }] })
      .expect(403);
  });

  it('replaces training rows, then GET returns exactly the new set', async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/training`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        rows: [{ title: 'Leadership', institution: 'Training Inst', from_date: '2021-01-01' }],
      })
      .expect(200);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/staff/${STAFF_USER_ID}/training`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].title).toBe('Leadership');
  });

  it('replaces achievement rows, then GET returns exactly the new set', async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/achievement`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({ rows: [{ title: 'Best Teacher Award', issued_by: 'Ministry' }] })
      .expect(200);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/staff/${STAFF_USER_ID}/achievement`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].title).toBe('Best Teacher Award');
  });

  it('replaces language rows, then GET returns exactly the new set', async () => {
    await supertest(app.getHttpServer())
      .put(`${API}/staff/${STAFF_USER_ID}/language`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .send({
        rows: [
          { language_name: 'Bangla', proficiency: 'Native' },
          { language_name: 'English', proficiency: 'Fluent' },
        ],
      })
      .expect(200);

    const listRes = await supertest(app.getHttpServer())
      .get(`${API}/staff/${STAFF_USER_ID}/language`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_A)
      .expect(200);

    expect(listRes.body).toHaveLength(2);
    expect(listRes.body.map((r: { language_name: string }) => r.language_name).sort()).toEqual([
      'Bangla',
      'English',
    ]);
  });
});
