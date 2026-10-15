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
 * [8.10.7.4.13] D46 matrix for the two office-staff student widgets: one `it`
 * per role per route. Only the catalogue roles (ADMIN, OFFICE_STAFF) get 200.
 */
const BASE = '/api/v1/dashboard/widgets';
const ROUTES = ['guardians-incomplete', 'students-added-today'] as const;
const ALLOWED = [UserRole.ADMIN, UserRole.OFFICE_STAFF];
const DENIED = [
  UserRole.EXECUTIVE,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

describe('[8.10.7.4.13] students dashboard widgets', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (route: string, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = http().get(`${BASE}/${route}`).set('Authorization', `Bearer ${tokens[role]}`);
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

    for (const [i, role] of [...ALLOWED, ...DENIED].entries()) {
      const id = `00000000-0000-4000-8000-00000189400${i.toString(16)}`;
      const email = `dash-stu-${role.toLowerCase()}@e2e.example`;
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

  it.each(ROUTES)('%s catalogue roles are exactly ADMIN, OFFICE_STAFF', (route) => {
    expect([...WIDGET_CATALOGUE[route].roles].sort()).toEqual([...ALLOWED].sort());
  });

  describe.each(ROUTES)('GET /dashboard/widgets/%s', (route) => {
    it.each(ALLOWED)('%s gets 200', async (role) => {
      expect((await get(route, role)).status).toBe(200);
    });

    it.each(DENIED)('%s gets 403', async (role) => {
      expect((await get(route, role)).status).toBe(403);
    });

    it('a tenant the caller is not a member of is refused', async () => {
      const res = await get(route, UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
      expect([401, 403]).toContain(res.status);
    });

    it('a missing X-Tenant-ID is refused', async () => {
      const res = await get(route, UserRole.ADMIN, null);
      expect([400, 401, 403]).toContain(res.status);
    });

    it('an invalid X-Tenant-ID is refused', async () => {
      const res = await get(route, UserRole.ADMIN, 'not-a-uuid');
      expect([400, 401, 403]).toContain(res.status);
    });
  });

  it('guardians-incomplete body is exactly the two counts', async () => {
    const res = await get('guardians-incomplete', UserRole.OFFICE_STAFF).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['incomplete_count', 'total_count']);
    expect(res.body.incomplete_count).toBeLessThanOrEqual(res.body.total_count);
  });

  it('students-added-today body keys are exactly added_today, as_of (no names leak)', async () => {
    const res = await get('students-added-today', UserRole.OFFICE_STAFF).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['added_today', 'as_of']);
    expect(res.body.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
