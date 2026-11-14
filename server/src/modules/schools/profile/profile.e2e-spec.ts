import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
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
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c7708';
  // Real school the caller has NO membership in.
  const STRANGER_TENANT_ID = '00000000-0000-4000-8000-0000000c7709';
  const READ_ROLES = [UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.PARENT, UserRole.STUDENT];
  const PROFILE = '/api/v1/schools/me/profile';
  const clearStored = () =>
    dataSource.query(
      `UPDATE schools SET settings = settings - 'modules' - 'labels' WHERE id = ANY($1)`,
      [[TENANT_ID, OTHER_TENANT_ID, STRANGER_TENANT_ID]],
    );
  const read = (tenant = TENANT_ID, role?: UserRole) => {
    const req = supertest(app.getHttpServer())
      .get(PROFILE)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', tenant);
    return role ? req.set('X-Role', role) : req;
  };

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
    for (const role of READ_ROLES) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Stranger Profile School', 'stranger-profile-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [STRANGER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Profile School', 'other-profile-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    await clearStored();

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await clearStored();
    await dataSource.query(
      `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`,
      [SEED_ADMIN_USER_ID, TENANT_ID, READ_ROLES],
    );
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
    // RolesGuard rejects a held-but-insufficient role with 403 ("Requires one of roles").
    const res = await supertest(app.getHttpServer())
      .patch('/api/v1/schools/me/profile')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ACCOUNTANT)
      .send({ name: 'Should not apply' })
      .expect(403);

    expect(res.body.message).toContain('Requires one of roles');
  });

  it('returns empty modules/labels blocks by default', async () => {
    const res = await read().expect(200);
    expect(res.body.modules).toEqual({ platform: {}, school: {} });
    expect(res.body.labels).toEqual({});
  });

  it('every role reads the blocks ADMIN PATCHed, and nothing from another tenant', async () => {
    const words = { class: { en: { one: 'Course', other: 'Courses' }, bn: 'কোর্স' } };
    await supertest(app.getHttpServer())
      .patch(`/api/v1/schools/${TENANT_ID}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        modules: { fees: { on: false } },
        labels: words,
      })
      .expect(200);
    await supertest(app.getHttpServer())
      .patch(`/api/v1/schools/${OTHER_TENANT_ID}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', OTHER_TENANT_ID)
      .send({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        modules: { exams: { on: false } },
        labels: { class: { en: { one: 'Other', other: 'Others' }, bn: 'অন্য' } },
      })
      .expect(200);

    for (const role of [UserRole.ADMIN, ...READ_ROLES]) {
      const res = await read(TENANT_ID, role).expect(200);
      expect(res.body.modules).toEqual({ platform: {}, school: { fees: { on: false } } });
      expect(res.body.labels).toEqual(words);
      expect(JSON.stringify(res.body)).not.toContain('অন্য');
    }
    const other = await read(OTHER_TENANT_ID).expect(200);
    expect(other.body.modules.school).toEqual({ exams: { on: false } });
  });

  it('refuses a caller who is not a member of the requested school', async () => {
    await read(STRANGER_TENANT_ID).expect(403);
  });

  it('refuses a missing or invalid X-Tenant-ID', async () => {
    await supertest(app.getHttpServer())
      .get(PROFILE)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(401);
    await read('not-a-uuid').expect(401);
  });
});
