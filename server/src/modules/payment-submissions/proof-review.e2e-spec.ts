import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_TENANT_ID,
} from '@test/constants';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { createProofFixture, JPEG } from '@test/helpers/proof-submissions.fixture';
import { AppModule } from '../../app.module';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { StorageService } from '../storage/storage.service';

class FakeStorage {
  async put() {}
  async deleteForTenant() {}
  async getForTenant() {
    const { Readable } = await import('stream');
    return { body: Readable.from([JPEG]), contentType: 'image/jpeg' };
  }
}

const URL = '/api/v1/payment-submissions';
const PROOF_URL = '/api/v1/portal/payment-proofs';
const UUID = '00000000-0000-4000-8000-0000000fffff';

/** [3.x/#3970] Staff proof review over HTTP: tenant header, roles, ids, limits, decisions. */
describe('Proof review (E2E)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fix: Awaited<ReturnType<typeof createProofFixture>>;
  let admin: string;
  let teacher: string;

  const call = (
    m: 'get' | 'post',
    url: string,
    token: string,
    tenant: string | null = SEED_TENANT_ID,
  ) => {
    const r = supertest(app.getHttpServer())[m](url).set('Authorization', `Bearer ${token}`);
    return tenant === null ? r : r.set('X-Tenant-ID', tenant);
  };
  const login = async (email: string, password: string) =>
    (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.access_token as string;
  const newProof = async () => {
    const bill = await fix.bill(fix.fx.studentA, 300);
    const res = await call('post', PROOF_URL, fix.parent.token)
      .field('billIds', bill)
      .field('method', 'BKASH')
      .field('amount', '300')
      .field('paidOn', '2000-01-01')
      .field('reference', `E2E-${randomUUID().slice(0, 8)}`)
      .attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    return res.body as { id: string; files: { id: string }[] };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useClass(FakeStorage)
      .compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    fix = await createProofFixture(app, ds);
    admin = await login(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
    const email = `review-teacher-${randomUUID().slice(0, 8)}@e2e.example`;
    const [u] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1,$2,'Review Teacher','ACTIVE',NOW(),NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1,$2,'TEACHER',NOW(),NOW())`,
      [u.id, SEED_TENANT_ID],
    );
    teacher = await login(email, SEED_ADMIN_PASSWORD);
  }, 120000);
  afterAll(async () => {
    await fix?.cleanup();
    await app?.close();
  });
  beforeEach(async () => {
    await fix.reset();
  });

  it('missing X-Tenant-ID is 401 and an invalid one is refused, on every route', async () => {
    const routes: ['get' | 'post', string][] = [
      ['get', URL],
      ['get', `${URL}/${UUID}`],
      ['get', `${URL}/${UUID}/files/${UUID}`],
      ['post', `${URL}/${UUID}/confirm`],
      ['post', `${URL}/${UUID}/reject`],
      ['post', `${URL}/${UUID}/reopen`],
    ];
    for (const [m, url] of routes) {
      await call(m, url, admin, null).expect(401);
      const bad = await call(m, url, admin, 'not-a-tenant');
      expect([400, 401, 403, 404]).toContain(bad.status);
      await call(m, url, admin, UUID).expect((r) => expect([401, 403, 404]).toContain(r.status));
    }
  });

  it('PARENT and TEACHER are 403 on list and confirm', async () => {
    for (const token of [fix.parent.token, teacher]) {
      await call('get', URL, token).expect(403);
      await call('post', `${URL}/${UUID}/confirm`, token).expect(403);
    }
  });

  it("another tenant's or unknown id is 404 with a fixed sentence", async () => {
    const res = await call('get', `${URL}/${UUID}`, admin).expect(404);
    expect(JSON.stringify(res.body)).not.toContain(UUID);
    await call('post', `${URL}/${UUID}/confirm`, admin).expect(404);
  });

  it('non-UUID ids are 400', async () => {
    await call('get', `${URL}/nope`, admin).expect(400);
    await call('get', `${URL}/${UUID}/files/nope`, admin).expect(400);
    await call('post', `${URL}/nope/confirm`, admin).expect(400);
  });

  it('list limit 101 is 400, 100 is fine', async () => {
    await call('get', `${URL}?limit=101`, admin).expect(400);
    await call('get', `${URL}?limit=100`, admin).expect(200);
  });

  it('OTHER without a note is 400; reject, reopen and file stream round trip', async () => {
    const p = await newProof();
    await call('post', `${URL}/${p.id}/reject`, admin).send({ reason: 'OTHER' }).expect(400);
    const stream = await call('get', `${URL}/${p.id}/files/${p.files[0].id}`, admin).expect(200);
    expect(stream.headers['cache-control']).toContain('no-store');
    await call('post', `${URL}/${p.id}/reject`, admin)
      .send({ reason: 'OTHER', note: 'blurry' })
      .expect(200);
    await call('post', `${URL}/${p.id}/reopen`, admin).send({ note: 'ok now' }).expect(200);
  });
});
