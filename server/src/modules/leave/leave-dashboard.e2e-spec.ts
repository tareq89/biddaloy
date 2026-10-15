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

/** [8.10.7.3.05] D46 matrix for `GET /dashboard/widgets/my-leave-balance`. */
const URL = '/api/v1/dashboard/widgets/my-leave-balance';
const ALLOWED = [
  UserRole.TEACHER,
  UserRole.ACCOUNTANT,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
];
const DENIED = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];
const KEYS = [
  'has_profile',
  'year',
  'total_quota_days',
  'total_used_days',
  'total_balance_days',
  'by_type',
];

describe('[8.10.7.3.05] GET /dashboard/widgets/my-leave-balance', () => {
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
      const id = `00000000-0000-4000-8000-00000186500${i.toString(16)}`;
      const email = `dash-leave-${role.toLowerCase()}@e2e.example`;
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

  it('catalogue roles are exactly the allowed four', () => {
    expect([...WIDGET_CATALOGUE['my-leave-balance'].roles].sort()).toEqual([...ALLOWED].sort());
  });

  it.each(ALLOWED)('%s gets 200 with exactly the DTO keys', async (role) => {
    const res = await get(role);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...KEYS].sort());
    // These users have no staff profile in the e2e tenant.
    expect(res.body.has_profile).toBe(false);
  });

  it.each(DENIED)('%s gets 403', async (role) => {
    expect((await get(role)).status).toBe(403);
  });

  it('a school-B header from a school-A caller is refused and leaks nothing', async () => {
    const res = await get(UserRole.TEACHER, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
    expect(res.body).not.toHaveProperty('by_type');
  });

  it('a missing X-Tenant-ID is rejected', async () => {
    const res = await http().get(URL).set('Authorization', `Bearer ${tokens[UserRole.TEACHER]}`);
    expect([400, 401, 403]).toContain(res.status);
  });
});
