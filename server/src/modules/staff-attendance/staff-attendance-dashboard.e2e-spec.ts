import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/** [8.10.7.2.02] D46 matrix for `GET /dashboard/widgets/staff-today`. */
const URL = '/api/v1/dashboard/widgets/staff-today';
const ALLOWED = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.OFFICE_STAFF];
const DENIED = [
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

describe('[8.10.7.2.02] GET /dashboard/widgets/staff-today', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (role: UserRole, tenantId = SEED_TENANT_ID) =>
    http().get(URL).set('Authorization', `Bearer ${tokens[role]}`).set('X-Tenant-ID', tenantId);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);

    for (const [i, role] of [...ALLOWED, ...DENIED].entries()) {
      const id = `00000000-0000-4000-8000-00000184800${i}`;
      const email = `dash-staff-${role.toLowerCase()}@e2e.example`;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH, `Dash ${role}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      tokens[role] = res.body.access_token;
    }
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('catalogue roles are exactly ADMIN, EXECUTIVE, OFFICE_STAFF', () => {
    expect([...WIDGET_CATALOGUE['staff-today'].roles].sort()).toEqual([...ALLOWED].sort());
  });

  it.each(ALLOWED)('%s gets 200 with the widget shape', async (role) => {
    const res = await get(role);
    expect(res.status).toBe(200);
    for (const k of ['staff_total', 'present', 'late', 'absent', 'leave', 'unmarked']) {
      expect(res.body).toHaveProperty(k);
    }
    expect(Array.isArray(res.body.on_leave)).toBe(true);
  });

  it.each(DENIED)('%s gets 403', async (role) => {
    expect((await get(role)).status).toBe(403);
  });

  it('a tenant the caller is not a member of is refused (401/403)', async () => {
    const res = await get(UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
  });

  // server/CLAUDE.md: always test a missing X-Tenant-ID.
  it('missing X-Tenant-ID returns 401', async () => {
    await http().get(URL).set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`).expect(401);
  });
});
