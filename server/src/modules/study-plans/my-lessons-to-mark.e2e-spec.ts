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

/**
 * [8.10.7.7.05] `GET /dashboard/widgets/my-lessons-to-mark`: D46 role matrix,
 * one explicit `it` per role, plus the tenant-header cases.
 */
const ROUTE = '/api/v1/dashboard/widgets/my-lessons-to-mark';
const ALL_ROLES = [
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

describe('[8.10.7.7.05] my-lessons-to-mark widget route', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = http().get(ROUTE).set('Authorization', `Bearer ${tokens[role]}`);
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

    for (const [i, role] of ALL_ROLES.entries()) {
      const id = `00000000-0000-4000-8000-00000193100${i}`;
      const email = `dash-lessons-mark-${role.toLowerCase()}@e2e.example`;
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

  it('catalogue: TEACHER only', () => {
    expect(WIDGET_CATALOGUE['my-lessons-to-mark'].roles).toEqual([UserRole.TEACHER]);
  });

  it('TEACHER gets 200 and the DTO keys (a teacher with no routine sees zero)', async () => {
    const res = await get(UserRole.TEACHER);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'oldest_planned_on', 'to_mark']);
    expect(res.body).toEqual({ to_mark: 0, oldest_planned_on: null, items: [] });
  });
  it('ADMIN gets 403', async () => {
    expect((await get(UserRole.ADMIN)).status).toBe(403);
  });
  it('EXECUTIVE gets 403', async () => {
    expect((await get(UserRole.EXECUTIVE)).status).toBe(403);
  });
  it('ACCOUNTANT gets 403', async () => {
    expect((await get(UserRole.ACCOUNTANT)).status).toBe(403);
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
    const res = await get(UserRole.TEACHER, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
  });
  it('a missing X-Tenant-ID is refused', async () => {
    expect([400, 401, 403]).toContain((await get(UserRole.TEACHER, null)).status);
  });
  it('an invalid X-Tenant-ID is refused', async () => {
    expect([400, 401, 403]).toContain((await get(UserRole.TEACHER, 'not-a-uuid')).status);
  });
});
