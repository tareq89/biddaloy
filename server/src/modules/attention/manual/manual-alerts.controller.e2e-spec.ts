import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { AttentionScheduler } from '../engine/attention-scheduler';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * E2E for /attention/manual [67.5.01]. The seed admin holds ADMIN (seed) plus the extra
 * roles added below, so one login can act as each role via X-Role.
 */
describe('Manual alerts API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let tenantB: string;
  const extra: string[] = [];
  const NEW_ROLES = [UserRole.EXECUTIVE, UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.PARENT];
  const body = (over: Record<string, unknown> = {}) => ({
    severity: 'WARNING',
    title: 'Classes start at 9:00',
    body: 'Rain delay.',
    audience: { roles: ['TEACHER'] },
    expiresOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()),
    ...over,
  });
  const call = (
    method: 'get' | 'post' | 'delete',
    path = '',
    role: UserRole = UserRole.ADMIN,
    tenantId: string | null = SEED_TENANT_ID,
  ) => {
    let req = supertest(app.getHttpServer())
      [method](`/api/v1/attention/manual${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', role);
    if (tenantId) req = req.set('X-Tenant-ID', tenantId);
    return req;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    // The live BullMQ scheduler sweeps on the real clock and would race exact-count assertions.
    await app.get(AttentionScheduler).worker.close();
    ds = app.get(DataSource);

    for (const role of NEW_ROLES) {
      const rows = await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (rows[0]) extra.push(rows[0].id);
    }
    [{ id: tenantB }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Manual E2E B', 'manual-e2e-b-' || substr(gen_random_uuid()::text, 1, 8)) RETURNING id`,
    );
    const [m] = await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW()) RETURNING id`,
      [SEED_ADMIN_USER_ID, tenantB],
    );
    extra.push(m.id);
    token = (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  beforeEach(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1::uuid[])`, [
      [SEED_TENANT_ID, tenantB],
    ]);
    await ds
      .query(`DELETE FROM audit_logs WHERE entity_type = 'Alert' AND tenant_id = $1`, [
        SEED_TENANT_ID,
      ])
      .catch(() => undefined); // append-only trigger may refuse; assertions below filter by id
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1::uuid[])`, [
      [SEED_TENANT_ID, tenantB],
    ]);
    await ds.query(`DELETE FROM user_tenants WHERE id = ANY($1::uuid[])`, [extra]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [tenantB]);
    await app.close();
  });

  it('ADMIN and EXECUTIVE can send (201), list, preview and withdraw (204)', async () => {
    for (const role of [UserRole.ADMIN, UserRole.EXECUTIVE]) {
      const sent = await call('post', '', role).send(body()).expect(201);
      expect(sent.body).toMatchObject({ title: 'Classes start at 9:00', status: 'ACTIVE' });
      const list = await call('get', '?pageSize=100', role).expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).toContain(sent.body.id);
      // an absurd page is a 400, not a float OFFSET 500
      await call('get', '?page=1e20', role).expect(400);
      const preview = await call('post', '/preview', role)
        .send({ audience: { roles: ['TEACHER'] } })
        .expect(200);
      expect(preview.body.recipientCount).toBeGreaterThan(0);
      await call('delete', `/${sent.body.id}`, role).expect(204);
    }
  });

  it('TEACHER, ACCOUNTANT and PARENT get 403 on every route', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const role of [UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.PARENT]) {
      await call('post', '', role).send(body()).expect(403);
      await call('get', '', role).expect(403);
      await call('post', '/preview', role).send({ audience: {} }).expect(403);
      await call('delete', `/${id}`, role).expect(403);
    }
  });

  it('missing or foreign X-Tenant-ID is rejected', async () => {
    await call('get', '', UserRole.ADMIN, null).expect(401);
    await call('get', '', UserRole.ADMIN, '00000000-0000-4000-8000-00000000dead').expect(401);
    await supertest(app.getHttpServer()).get('/api/v1/attention/manual').expect(401);
  });

  it('rejects CRITICAL, off-site actionUrls, unknown keys and a bad id', async () => {
    await call('post')
      .send(body({ severity: 'CRITICAL' }))
      .expect(400);
    await call('post')
      .send(body({ actionUrl: '//evil.example' }))
      .expect(400);
    await call('post')
      .send(body({ actionUrl: 'https://evil.example' }))
      .expect(400);
    await call('post')
      .send(body({ actionUrl: '/\\evil.example' }))
      .expect(400);
    await call('post')
      .send(body({ surprise: 1 }))
      .expect(400);
    await call('post')
      .send(body({ audience: {} }))
      .expect(400);
    await call('post')
      .send(body({ audience: { roles: ['SUPER_ADMIN'] } }))
      .expect(400);
    await call('delete', '/not-a-uuid').expect(400);
    await call('post')
      .send(body({ actionUrl: '/routines/my' }))
      .expect(201);
  });

  it("another school's admin cannot withdraw this school's alert (404)", async () => {
    const sent = await call('post').send(body()).expect(201);
    await call('delete', `/${sent.body.id}`, UserRole.ADMIN, tenantB).expect(404);
    const [{ status }] = await ds.query(`SELECT status FROM alerts WHERE id = $1`, [sent.body.id]);
    expect(status).toBe('ACTIVE');
    // and it is invisible in that school's list
    const list = await call('get', '', UserRole.ADMIN, tenantB).expect(200);
    expect(list.body.items).toEqual([]);
  });

  it('writes an audit row on send and on withdraw', async () => {
    const sent = await call('post').send(body()).expect(201);
    await call('delete', `/${sent.body.id}`).expect(204);
    const rows = await ds.query(
      `SELECT action FROM audit_logs WHERE entity_type = 'Alert' AND entity_id = $1 ORDER BY created_at`,
      [sent.body.id],
    );
    expect(rows.map((r: { action: string }) => r.action)).toEqual(['CREATE', 'DELETE']);
  });
});
