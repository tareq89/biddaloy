import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DashboardWidgetKey, UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * [8.10.7.2.06] D46 matrix for `GET /dashboard/widgets/sms-balance` and
 * `/failed-messages`: only the catalogue role (ADMIN) gets 200; every other role is 403.
 */
const ALLOWED = [UserRole.ADMIN];
const DENIED = [
  UserRole.EXECUTIVE,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];
const KEYS = [DashboardWidgetKey.SMS_BALANCE, DashboardWidgetKey.FAILED_MESSAGES];

describe('[8.10.7.2.06] communications dashboard widgets', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (key: string, role: UserRole, tenantId = SEED_TENANT_ID) =>
    http()
      .get(`/api/v1/dashboard/widgets/${key}`)
      .set('Authorization', `Bearer ${tokens[role]}`)
      .set('X-Tenant-ID', tenantId);

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
      const id = `00000000-0000-4000-8000-00000185200${i}`;
      const email = `dash-comm-${role.toLowerCase()}@e2e.example`;
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

  describe.each(KEYS)('GET /dashboard/widgets/%s', (key) => {
    it('catalogue roles are exactly ADMIN', () => {
      expect([...WIDGET_CATALOGUE[key].roles].sort()).toEqual([...ALLOWED].sort());
    });

    it.each(ALLOWED)('%s gets 200', async (role) => {
      expect((await get(key, role)).status).toBe(200);
    });

    it.each(DENIED)('%s gets 403', async (role) => {
      expect((await get(key, role)).status).toBe(403);
    });

    it('a tenant the caller is not a member of is refused', async () => {
      const res = await get(key, UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
      expect([401, 403]).toContain(res.status);
    });
  });

  it('sms-balance returns metering, available and reserved', async () => {
    const res = await get('sms-balance', UserRole.ADMIN);
    expect(Object.keys(res.body).sort()).toEqual(['available', 'metering', 'reserved']);
  });

  it('failed-messages returns exactly failed and window', async () => {
    const res = await get('failed-messages', UserRole.ADMIN);
    expect(Object.keys(res.body).sort()).toEqual(['failed', 'window']);
    expect(Object.keys(res.body.window).sort()).toEqual(['from', 'to']);
  });

  // server/CLAUDE.md: always test a missing X-Tenant-ID.
  it.each(KEYS)('%s: missing X-Tenant-ID returns 401', async (key) => {
    await http()
      .get(`/api/v1/dashboard/widgets/${key}`)
      .set('Authorization', `Bearer ${tokens[UserRole.ADMIN]}`)
      .expect(401);
  });
});
