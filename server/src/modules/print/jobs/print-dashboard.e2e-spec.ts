import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DashboardWidgetKey, Permission, UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * [8.10.7.7.02] D46 matrix for `GET /dashboard/widgets/print-queue`: OFFICE_STAFF,
 * EXAM_CONTROLLER and ADMIN get 200, every other role 403. The card is the to-print
 * queue's own count (`GET /print-history/queue`), so the two must reconcile.
 */
const KEY = DashboardWidgetKey.PRINT_QUEUE;
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

describe('[8.10.7.7.02] GET /dashboard/widgets/print-queue', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (
    role: UserRole,
    tenantId: string | null = SEED_TENANT_ID,
    path = `/dashboard/widgets/${KEY}`,
  ) => {
    const req = http().get(`/api/v1${path}`).set('Authorization', `Bearer ${tokens[role]}`);
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
      const id = `00000000-0000-4000-8000-00000192800${i}`;
      const email = `dash-prq-${role.toLowerCase()}@e2e.example`;
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

  it('catalogue gates on DOCUMENT_PRINT for exactly OFFICE_STAFF, EXAM_CONTROLLER, ADMIN', () => {
    expect(WIDGET_CATALOGUE[KEY].permissions).toEqual([Permission.DOCUMENT_PRINT]);
    expect([...WIDGET_CATALOGUE[KEY].roles].sort()).toEqual(
      [UserRole.ADMIN, UserRole.EXAM_CONTROLLER, UserRole.OFFICE_STAFF].sort(),
    );
  });

  it('ADMIN gets 200 with only total and by_kind (counts, no names)', async () => {
    const res = await get(UserRole.ADMIN);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['by_kind', 'total']);
  });

  it('equals the to-print queue for the same tenant (reconciliation)', async () => {
    const widget = await get(UserRole.ADMIN);
    const queue = await get(UserRole.ADMIN, SEED_TENANT_ID, '/print-history/queue');
    expect(queue.status).toBe(200);
    expect(widget.body.total).toBe(queue.body.total);
    expect(widget.body.by_kind).toEqual(queue.body.by_kind);
  });

  it('OFFICE_STAFF gets 200', async () => {
    expect((await get(UserRole.OFFICE_STAFF)).status).toBe(200);
  });

  it('EXAM_CONTROLLER gets 200', async () => {
    expect((await get(UserRole.EXAM_CONTROLLER)).status).toBe(200);
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
