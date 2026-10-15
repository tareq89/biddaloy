import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DashboardWidgetKey, Permission, UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * [8.10.7.7.01] D46 matrix for `GET /dashboard/widgets/approvals-pending`:
 * catalogue roles (ADMIN, EXECUTIVE) get 200, every other role is 403 even though
 * several of them hold APPLICATION_SUBMIT. The caller sees only their own inbox.
 */
const KEY = DashboardWidgetKey.APPROVALS_PENDING;
const ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

describe('[8.10.7.7.01] GET /dashboard/widgets/approvals-pending', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = http()
      .get(`/api/v1/dashboard/widgets/${KEY}`)
      .set('Authorization', `Bearer ${tokens[role]}`);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);

    for (const [i, role] of ROLES.entries()) {
      const id = `00000000-0000-4000-8000-00000192700${i}`;
      const email = `dash-apr-${role.toLowerCase()}@e2e.example`;
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

  it('catalogue gates on APPLICATION_SUBMIT for exactly ADMIN and EXECUTIVE', () => {
    expect(WIDGET_CATALOGUE[KEY].permissions).toEqual([Permission.APPLICATION_SUBMIT]);
    expect([...WIDGET_CATALOGUE[KEY].roles].sort()).toEqual(
      [UserRole.ADMIN, UserRole.EXECUTIVE].sort(),
    );
  });

  it('ADMIN gets 200 with the documented shape', async () => {
    const res = await get(UserRole.ADMIN);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['by_type', 'oldest_pending_at', 'total']);
    expect(Array.isArray(res.body.by_type)).toBe(true);
  });

  it('EXECUTIVE gets 200', async () => {
    expect((await get(UserRole.EXECUTIVE)).status).toBe(200);
  });

  it('ACCOUNTANT gets 403 (decides fee waivers, but is not offered this card)', async () => {
    expect((await get(UserRole.ACCOUNTANT)).status).toBe(403);
  });

  it('TEACHER gets 403', async () => {
    expect((await get(UserRole.TEACHER)).status).toBe(403);
  });

  it('OFFICE_STAFF gets 403', async () => {
    expect((await get(UserRole.OFFICE_STAFF)).status).toBe(403);
  });

  it('EXAM_CONTROLLER gets 403', async () => {
    expect((await get(UserRole.EXAM_CONTROLLER)).status).toBe(403);
  });

  it('COMMITTEE gets 403', async () => {
    expect((await get(UserRole.COMMITTEE)).status).toBe(403);
  });

  it('PARENT gets 403', async () => {
    expect((await get(UserRole.PARENT)).status).toBe(403);
  });

  it('STUDENT gets 403', async () => {
    expect((await get(UserRole.STUDENT)).status).toBe(403);
  });

  it('a tenant the caller is not a member of is refused', async () => {
    const res = await get(UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
  });

  it('a missing X-Tenant-ID is refused', async () => {
    const res = await get(UserRole.ADMIN, null);
    expect([400, 401, 403]).toContain(res.status);
  });

  it('an invalid X-Tenant-ID is refused', async () => {
    const res = await get(UserRole.ADMIN, 'not-a-uuid');
    expect([400, 401, 403]).toContain(res.status);
  });
});
