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
 * [8.10.7.2.01] D46 matrix for `GET /dashboard/widgets/attendance-today`: only the
 * catalogue roles get 200; everyone else is 403 (missing permission or DASHBOARD_WIDGET_ROLE).
 */
const URL = '/api/v1/dashboard/widgets/attendance-today';
const ALLOWED = [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.OFFICE_STAFF];
const DENIED = [
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

describe('[8.10.7.2.01] GET /dashboard/widgets/attendance-today', () => {
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
      const id = `00000000-0000-4000-8000-00000184700${i}`;
      const email = `dash-att-${role.toLowerCase()}@e2e.example`;
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
    expect([...WIDGET_CATALOGUE['attendance-today'].roles].sort()).toEqual([...ALLOWED].sort());
  });

  it.each(ALLOWED)('%s gets 200 with the widget shape', async (role) => {
    const res = await get(role);
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(30);
    expect(res.body).toHaveProperty('pending_sections');
    expect(res.body.counts).toHaveProperty('unmarked');
  });

  it.each(DENIED)('%s gets 403', async (role) => {
    expect((await get(role)).status).toBe(403);
  });

  it('a tenant the caller is not a member of is refused (401: ContextGuard finds no membership)', async () => {
    const res = await get(UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
  });

  // [8.10.7.3.02] Teacher widgets: only TEACHER gets 200, every other role is 403.
  describe.each([
    ['my-pending-sections', ['date', 'is_working_day', 'pending_count', 'sections']],
    ['class-teacher-streaks', ['section', 'as_of_date', 'total', 'items']],
  ])('GET /dashboard/widgets/%s', (widget, keys) => {
    const widgetUrl = `/api/v1/dashboard/widgets/${widget}`;
    const call = (role: UserRole, tenantId = SEED_TENANT_ID) =>
      http()
        .get(widgetUrl)
        .set('Authorization', `Bearer ${tokens[role]}`)
        .set('X-Tenant-ID', tenantId);

    it('catalogue roles are exactly TEACHER', () => {
      expect([...WIDGET_CATALOGUE[widget as keyof typeof WIDGET_CATALOGUE].roles]).toEqual([
        UserRole.TEACHER,
      ]);
    });

    it('TEACHER gets 200 with exactly the DTO keys', async () => {
      const res = await call(UserRole.TEACHER);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([...keys].sort());
    });

    it.each([
      UserRole.ADMIN,
      UserRole.EXECUTIVE,
      UserRole.ACCOUNTANT,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
      UserRole.PARENT,
      UserRole.STUDENT,
    ])('%s gets 403', async (role) => {
      expect((await call(role)).status).toBe(403);
    });

    it('a missing X-Tenant-ID is refused', async () => {
      const res = await http()
        .get(widgetUrl)
        .set('Authorization', `Bearer ${tokens[UserRole.TEACHER]}`);
      expect([400, 401, 403]).toContain(res.status);
    });

    it("a school A caller with school B's header never sees B's data", async () => {
      const res = await call(UserRole.TEACHER, '00000000-0000-4000-8000-0000000000aa');
      expect([401, 403]).toContain(res.status);
    });
  });
});
