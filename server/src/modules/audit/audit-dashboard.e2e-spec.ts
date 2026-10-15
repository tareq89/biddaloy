import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DashboardWidgetKey, UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import type Redis from 'ioredis';
import { AppModule } from '../../app.module';
import { DashboardCacheService } from '../dashboard/dashboard-cache.service';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * [8.10.7.3.18] D46 matrix for `GET /dashboard/widgets/recent-activity`: only the
 * catalogue role (ADMIN) gets 200; every other role is 403.
 */
const KEY = DashboardWidgetKey.RECENT_ACTIVITY;
const ADMIN_ID = '00000000-0000-4000-8000-000001878000'; // first user created below (i = 0)
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

describe('[8.10.7.3.18] recent-activity widget', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = http()
      .get(`/api/v1/dashboard/widgets/${KEY}`)
      .set('Authorization', `Bearer ${tokens[role]}`);
    return tenantId ? req.set('X-Tenant-ID', tenantId) : req;
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
      const id = `00000000-0000-4000-8000-00000187800${i}`;
      const email = `dash-audit-${role.toLowerCase()}@e2e.example`;
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

  it('catalogue roles are exactly ADMIN', () => {
    expect([...WIDGET_CATALOGUE[KEY].roles].sort()).toEqual([...ALLOWED].sort());
  });

  it('ADMIN gets 200', async () => {
    expect((await get(UserRole.ADMIN)).status).toBe(200);
  });

  it('EXECUTIVE gets 403', async () => {
    expect((await get(UserRole.EXECUTIVE)).status).toBe(403);
  });
  it('ACCOUNTANT gets 403', async () => {
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

  it('a missing X-Tenant-ID is rejected', async () => {
    const res = await get(UserRole.ADMIN, null);
    expect([400, 401, 403]).toContain(res.status);
  });

  it('a tenant the caller is not a member of is refused, so school B data is never served', async () => {
    const res = await get(UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
    expect(res.body.items).toBeUndefined();
  });

  it('returns exactly { items } and no row carries raw JSON, ip, user agent or tenant id', async () => {
    // Inserted here, not in beforeAll: transactional tables are wiped before every test.
    // One UPDATE row with raw JSON, ip and user agent; the widget must reduce it to a count.
    await app.get(DataSource).query(
      `INSERT INTO audit_logs (tenant_id, action, entity_type, old_values, new_values, ip_address, user_agent)
       VALUES ($1, 'UPDATE', 'Student', '{"a":1,"b":2}', '{"a":9,"b":2}', '10.0.0.1', 'e2e-agent')`,
      [SEED_TENANT_ID],
    );
    // Earlier tests already warmed the 60 s per-user cache; drop it so this read is live.
    const cache = app.get(DashboardCacheService);
    await app
      .get<Redis>(TENANT_STATUS_REDIS)
      .del(cache.key(SEED_TENANT_ID, KEY, `user:${ADMIN_ID}`));
    const res = await get(UserRole.ADMIN);
    expect(Object.keys(res.body)).toEqual(['items']);
    expect(res.body.items.length).toBeLessThanOrEqual(8);
    expect(res.body.items[0].changed_field_count).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.1|e2e-agent/);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual([
        'action',
        'changed_field_count',
        'created_at',
        'entity_label',
        'entity_type',
        'id',
        'performed_by_name',
      ]);
      expect(item).not.toHaveProperty('old_values');
      expect(item).not.toHaveProperty('new_values');
    }
  });
});
