import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/** [69.2.02] Year rollover routes: permission, tenant scoping, validation, idempotency. */
describe('Year rollover routes (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let sourceId: string;
  const sfx = randomUUID().slice(0, 8);
  const body = (name: string) => ({
    name,
    start_date: '2031-01-01',
    end_date: '2031-12-31',
    include: ['classes', 'sections'],
  });

  const login = async () =>
    (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;

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
    await app.listen(0);
    ds = app.get(DataSource);
    adminToken = await login();

    const year = await supertest(app.getHttpServer())
      .post('/api/v1/academic-years')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({ name: `roll-src-${sfx}`, start_date: '2030-01-01', end_date: '2030-12-31' })
      .expect(201);
    sourceId = year.body.id;
    await ds.query(`INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ($1, $2, $3)`, [
      `Rollover ${sfx}`,
      sourceId,
      SEED_TENANT_ID,
    ]);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  const post = (id: string, token = adminToken) =>
    supertest(app.getHttpServer())
      .post(`/api/v1/academic-years/${id}/next`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

  it('ADMIN gets 201 with counts', async () => {
    const res = await post(sourceId)
      .send(body(`roll-a-${sfx}`))
      .expect(201);
    expect(res.body.target_year_id).toBeDefined();
    expect(res.body.classes.created).toBe(1);
  });

  it('copies terms shifted into the new year (deferred from #3517)', async () => {
    await ds.query(
      `INSERT INTO academic_terms (tenant_id, academic_year_id, seq, name, start_date, end_date)
       VALUES ($1, $2, 1, 'Term 1', '2030-01-01', '2030-06-30')`,
      [SEED_TENANT_ID, sourceId],
    );
    const res = await post(sourceId)
      .send({ ...body(`roll-t-${sfx}`), include: ['terms'] })
      .expect(201);
    expect(res.body.terms.created).toBe(1);
    const rows = await ds.query(
      `SELECT start_date::text AS s FROM academic_terms WHERE academic_year_id = $1`,
      [res.body.target_year_id],
    );
    expect(rows).toEqual([{ s: '2031-01-01' }]);
  });

  it('preview answers 200 and writes no year', async () => {
    const name = `roll-p-${sfx}`;
    const res = await supertest(app.getHttpServer())
      .get(`/api/v1/academic-years/${sourceId}/next/preview`)
      .query({ ...body(name), include: 'classes' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(200);
    expect(res.body.classes.created).toBe(1);
    const rows = await ds.query(`SELECT 1 FROM academic_years WHERE name = $1`, [name]);
    expect(rows).toHaveLength(0);
  });

  it('403 for a role without ACADEMIC_YEAR_MANAGE (STUDENT)', async () => {
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, SEED_TENANT_ID, UserRole.STUDENT],
    );
    const studentToken = await login();
    await post(sourceId, studentToken)
      .set('X-Role', UserRole.STUDENT)
      .send(body(`roll-s-${sfx}`))
      .expect(403);
  });

  it('401 without X-Tenant-ID', async () => {
    await supertest(app.getHttpServer())
      .post(`/api/v1/academic-years/${sourceId}/next`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body(`roll-n-${sfx}`))
      .expect(401);
  });

  it('rejects an invalid X-Tenant-ID', async () => {
    const res = await supertest(app.getHttpServer())
      .post(`/api/v1/academic-years/${sourceId}/next`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', 'not-a-tenant')
      .send(body(`roll-i-${sfx}`));
    expect([400, 401, 403, 404]).toContain(res.status);
  });

  it("404 for another tenant's source year, and the answer does not echo input", async () => {
    const other = '00000000-0000-4000-8000-0000000000a9';
    await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES ($1, 'Roll Other', $2) ON CONFLICT DO NOTHING`,
      [other, `roll-other-${sfx}`],
    );
    const foreign = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ($1, '2030-01-01', '2030-12-31', $2) RETURNING id`,
      [`foreign-${sfx}`, other],
    );
    const res = await post(foreign[0].id)
      .send(body(`roll-f-${sfx}`))
      .expect(404);
    expect(JSON.stringify(res.body)).not.toContain(`roll-f-${sfx}`);
  });

  it('400 for a non-UUID id and for a bad body', async () => {
    await post('not-a-uuid')
      .send(body(`roll-u-${sfx}`))
      .expect(400);
    await post(sourceId)
      .send({ ...body(`roll-b-${sfx}`), end_date: '2030-01-01' })
      .expect(400);
    await post(sourceId)
      .send({ ...body(`roll-b2-${sfx}`), include: ['nope'] })
      .expect(400);
  });

  it('the same Idempotency-Key twice returns the same answer and creates rows once', async () => {
    const key = `roll-${sfx}`;
    const name = `roll-k-${sfx}`;
    const first = await post(sourceId).set('Idempotency-Key', key).send(body(name)).expect(201);
    const second = await post(sourceId).set('Idempotency-Key', key).send(body(name)).expect(201);
    expect(second.body).toEqual(first.body);
    const rows = await ds.query(`SELECT 1 FROM classes WHERE academic_year_id = $1`, [
      first.body.target_year_id,
    ]);
    expect(rows).toHaveLength(1);
  });
});
