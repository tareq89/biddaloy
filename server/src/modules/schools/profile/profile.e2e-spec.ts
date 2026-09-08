import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * [15.5.2] `GET`/`PATCH /schools/me/profile`, end-to-end. Proves the role
 * gate (ADMIN can edit, ACCOUNTANT cannot) and the audit trail through a
 * real HTTP round trip and a real DB row — the controller/service specs
 * cover the delegation logic, this proves the guard stack + persistence
 * actually wire together.
 */
describe('School profile (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // Seeded admin also gets an ACCOUNTANT membership in the same tenant,
    // so one token can probe both roles via X-Role without a second user.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.ACCOUNTANT}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('lets ADMIN read the profile', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/schools/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('logo_url');
  });

  it('lets ADMIN update the profile and audits the change', async () => {
    const newName = `Updated School ${Date.now()}`;

    const res = await supertest(app.getHttpServer())
      .patch('/api/v1/schools/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ name: newName, registration_id: 'EIIN-12345' })
      .expect(200);

    expect(res.body.name).toBe(newName);
    expect(res.body.registration_id).toBe('EIIN-12345');

    const auditRows = await dataSource.query(
      `SELECT action, entity_type, new_values FROM audit_logs
       WHERE entity_type = 'School' AND entity_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [TENANT_ID],
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('UPDATE');
    expect(auditRows[0].new_values.name).toBe(newName);
  });

  it('rejects an ACCOUNTANT trying to update the profile', async () => {
    // RolesGuard rejects a held-but-insufficient role with 401, matching
    // role-resolution.e2e-spec.ts's "Requires one of roles" behavior — not
    // 403 (which class-level PermissionsGuard checks use).
    const res = await supertest(app.getHttpServer())
      .patch('/api/v1/schools/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ACCOUNTANT)
      .send({ name: 'Should not apply' })
      .expect(401);

    expect(res.body.message).toContain('Requires one of roles');
  });
});
