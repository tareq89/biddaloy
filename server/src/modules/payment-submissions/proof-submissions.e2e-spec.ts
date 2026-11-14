import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SEED_TENANT_ID } from '@test/constants';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { AppModule } from '../../app.module';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { StorageService } from '../storage/storage.service';
import { createProofFixture, JPEG } from '@test/helpers/proof-submissions.fixture';

class FakeStorage {
  async put() {}
  async deleteForTenant() {}
  async getForTenant() {
    const { Readable } = await import('stream');
    return { body: Readable.from([JPEG]), contentType: 'image/jpeg' };
  }
}

const URL = '/api/v1/portal/payment-proofs';
const UUID = '00000000-0000-4000-8000-0000000fffff';

/** [3.x/#3965] Guardian proof routes over HTTP: tenant header, roles, ownership, upload signature. */
describe('Payment proofs (E2E)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fix: Awaited<ReturnType<typeof createProofFixture>>;

  const call = (
    m: 'get' | 'post',
    url: string,
    token: string,
    tenant: string | null = SEED_TENANT_ID,
  ) => {
    const r = supertest(app.getHttpServer())[m](url).set('Authorization', `Bearer ${token}`);
    return tenant === null ? r : r.set('X-Tenant-ID', tenant);
  };
  const submit = (token: string, billId: string, amount: string) =>
    call('post', URL, token)
      .field('billIds', billId)
      .field('method', 'BKASH')
      .field('amount', amount)
      .field('paidOn', '2000-01-01')
      .field('reference', 'TRX1');

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
  }, 120000);
  afterAll(async () => {
    await fix?.cleanup();
    await app?.close();
  });
  beforeEach(() => fix.reset());

  it('missing X-Tenant-ID is 401 and an invalid one is refused, on every route', async () => {
    const routes: ['get' | 'post', string][] = [
      ['get', URL],
      ['post', URL],
      ['post', `${URL}/${UUID}/withdraw`],
      ['get', `${URL}/${UUID}/files/${UUID}`],
    ];
    for (const [m, url] of routes) {
      await call(m, url, fix.parent.token, null).expect(401);
      const bad = await call(m, url, fix.parent.token, 'not-a-tenant');
      expect([400, 401, 403, 404]).toContain(bad.status);
      await call(m, url, fix.parent.token, UUID).expect((r) =>
        expect([401, 403, 404]).toContain(r.status),
      );
    }
  });

  it('submit, list, file stream and withdraw round trip; other guardian cannot withdraw', async () => {
    const bill = await fix.bill(fix.fx.studentA, 300);
    const res = await submit(fix.parent.token, bill, '300')
      .attach('files', JPEG, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    const id = res.body.id;
    const list = await call('get', `${URL}?studentId=${fix.fx.studentA}`, fix.parent.token).expect(
      200,
    );
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([id]);
    const stream = await call(
      'get',
      `${URL}/${id}/files/${res.body.files[0].id}`,
      fix.parent.token,
    ).expect(200);
    expect(stream.headers['cache-control']).toContain('no-store');
    // The other family's guardian is not linked to this child: 404.
    await call('post', `${URL}/${id}/withdraw`, fix.other.token).expect(404);
    await call('get', `${URL}/${id}/files/${res.body.files[0].id}`, fix.other.token).expect(404);
    const w = await call('post', `${URL}/${id}/withdraw`, fix.parent.token).expect(200);
    expect(w.body.status).toBe('WITHDRAWN');
  });

  it("another family's bill is 404 with a fixed sentence that does not echo input", async () => {
    const bill = await fix.bill(fix.fx.studentB, 300);
    const res = await submit(fix.parent.token, bill, '300').expect(404);
    expect(JSON.stringify(res.body)).not.toContain(bill);
    expect(JSON.stringify(res.body)).not.toContain('TRX1');
  });

  it('a STUDENT role is 403', async () => {
    await call('get', URL, fix.student.token).expect(403);
  });

  it('non-UUID ids are 400', async () => {
    await call('post', `${URL}/nope/withdraw`, fix.parent.token).expect(400);
    await call('get', `${URL}/${UUID}/files/nope`, fix.parent.token).expect(400);
  });

  it('a file whose bytes do not match its type is 400 and nothing is saved', async () => {
    const bill = await fix.bill(fix.fx.studentA, 300);
    await submit(fix.parent.token, bill, '300')
      .attach('files', Buffer.from('not a jpeg at all'), {
        filename: 'a.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);
    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int n FROM payment_submissions WHERE tenant_id=$1`,
      [SEED_TENANT_ID],
    );
    expect(n).toBe(0);
  });
});
