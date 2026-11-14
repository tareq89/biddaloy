import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { BkashClient } from '../billing/bkash/bkash.client';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { SmsExpiryService } from './expiry/sms-expiry.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

const TENANT_ID = '00000000-0000-4000-8000-0000003866a1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000003866b1';
const ADMIN = { id: '00000000-0000-4000-8000-0000003866a2', email: 'a@sms-bundles-e2e.example' };
const TEACHER = { id: '00000000-0000-4000-8000-0000003866a3', email: 't@sms-bundles-e2e.example' };

const PACKAGE_ID = '00000000-0000-4000-8000-0000003866c1';
const PRICE_PAISA = '300000';
const SMS_COUNT = 100;

/** The gateway is stubbed; everything behind it (Redis state, callback, markPaid, lot) is real. */
const bkash = {
  isConfigured: () => true,
  paid: new Map<string, { orderId: string; trxID: string }>(),
  create: async (o: { orderId: string }) => {
    const paymentID = `TR${String(bkash.paid.size + 1).padStart(10, '0')}`;
    bkash.paid.set(paymentID, { orderId: o.orderId, trxID: `TRX${paymentID}` });
    return { statusCode: '0000', paymentID, bkashURL: `https://pay.example/${paymentID}` };
  },
  query: async (paymentID: string) => {
    const p = bkash.paid.get(paymentID)!;
    return {
      statusCode: '0000',
      paymentID,
      trxID: p.trxID,
      transactionStatus: 'Completed',
      amount: '3000.00',
      currency: 'BDT',
      merchantInvoiceNumber: p.orderId,
    };
  },
  execute: async (paymentID: string) => bkash.query(paymentID),
};

/**
 * [Epic 100 #3866] The school-side SMS routes: the app boots with the module wired, a school
 * admin reads its own catalog and source, a teacher is refused, and another school's tenant id
 * or a missing/invalid X-Tenant-ID gets no answer.
 */
describe('sms-bundles E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const tokens: Record<string, string> = {};

  const call = (
    method: 'get' | 'put' | 'post',
    path: string,
    token?: string,
    tenant: string | null = TENANT_ID,
  ) => {
    const req = supertest(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (tenant !== null) req.set('X-Tenant-ID', tenant);
    return req;
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BkashClient)
      .useValue(bkash)
      .compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    for (const [id, slug] of [
      [TENANT_ID, 'sms-bundles-e2e'],
      [OTHER_TENANT_ID, 'sms-bundles-e2e-other'],
    ]) {
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'SMS Bundles E2E', $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, slug],
      );
    }
    for (const [user, role] of [
      [ADMIN, UserRole.ADMIN],
      [TEACHER, UserRole.TEACHER],
    ] as const) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'SMS Bundles E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [user.id, user.email, SEED_ADMIN_PASSWORD_HASH],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [user.id, TENANT_ID, role],
      );
    }
    const loginAs = async (email: string) =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    tokens.admin = await loginAs(ADMIN.email);
    tokens.teacher = await loginAs(TEACHER.email);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  const lots = () =>
    dataSource.query(
      `SELECT id, units_total, remaining, reserved_units, debited_units, expired_units, status
         FROM sms_credit_lots WHERE tenant_id = $1 ORDER BY created_at`,
      [TENANT_ID],
    );
  const ledgerKinds = async () =>
    (
      await dataSource.query(
        `SELECT kind FROM sms_credit_ledger WHERE tenant_id = $1 ORDER BY created_at, id`,
        [TENANT_ID],
      )
    ).map((r: { kind: string }) => r.kind);

  it('gives an ADMIN the catalog, the orders and the SMS source', async () => {
    await call('get', 'sms-bundles/catalog', tokens.admin).expect(200);
    await call('get', 'sms-bundles/orders', tokens.admin).expect(200);
    await call('get', 'communications/sms-source', tokens.admin).expect(200);
  });

  it('refuses a TEACHER (403) and a missing token (401)', async () => {
    await call('get', 'sms-bundles/catalog', tokens.teacher).expect(403);
    await call('get', 'sms-bundles/orders', tokens.teacher).expect(403);
    await call('put', 'communications/sms-source', tokens.teacher).expect(403);
    await call('get', 'sms-bundles/catalog').expect(401);
  });

  it('refuses a missing, malformed or other school X-Tenant-ID', async () => {
    for (const tenant of [null, 'not-a-uuid', OTHER_TENANT_ID]) {
      const res = await call('get', 'sms-bundles/orders', tokens.admin, tenant);
      expect([400, 401, 403, 404], `tenant=${tenant}`).toContain(res.status);
    }
  });
  // One test: the harness clears the tables between tests, and these steps build on each other.
  it('buy, pay with bKash, send, expire, switch source', async () => {
    let orderId: string;
    const sendRef = crypto.randomUUID();
    const overRef = crypto.randomUUID();
    const step = async (_name: string, fn: () => Promise<void>) => fn();

    await step(
      'refuses to buy while the school uses its own provider, then buys after the switch',
      async () => {
        await dataSource.query(
          `INSERT INTO sms_bundle_catalog (id, name, sms_count, validity_days, price_paisa, active)
         VALUES ($1, 'E2E 100', $2, 30, $3, true) ON CONFLICT DO NOTHING`,
          [PACKAGE_ID, SMS_COUNT, PRICE_PAISA],
        );
        const body = { package_id: PACKAGE_ID, idempotency_key: crypto.randomUUID() };
        const refused = await call('post', 'sms-bundles/orders', tokens.admin)
          .send(body)
          .expect(409);
        expect(JSON.stringify(refused.body)).toContain('SMS_SOURCE_NOT_PLATFORM');

        const switched = await call('put', 'communications/sms-source', tokens.admin)
          .send({ source: 'SCHOOLMANAGERP' })
          .expect(200);
        expect(switched.body.source).toBe('SCHOOLMANAGERP');
        const made = await call('post', 'sms-bundles/orders', tokens.admin).send(body).expect(201);
        orderId = made.body.id;
        expect(made.body.status).toBe('PENDING_PAYMENT');
        // The same key again is the same order.
        const again = await call('post', 'sms-bundles/orders', tokens.admin).send(body).expect(201);
        expect(again.body.id).toBe(orderId);
      },
    );

    await step(
      'pays with bKash: the callback activates the order, makes one lot and returns to the SMS page',
      async () => {
        const pay = await call(
          'post',
          `sms-bundles/orders/${orderId}/pay/bkash`,
          tokens.admin,
        ).expect(200);
        expect(pay.body.bkash_url).toContain('https://pay.example/');
        const paymentID = pay.body.bkash_url.split('/').pop() as string;
        const res = await supertest(app.getHttpServer())
          .get('/api/v1/billing/bkash/callback')
          .query({ paymentID, status: 'success' })
          .expect(302);
        expect(res.header.location).toContain('smsBuy=1');
        expect(res.header.location).toContain(`order=${orderId}`);
        expect(res.header.location).toContain('payment=success');

        const order = await call('get', `sms-bundles/orders/${orderId}`, tokens.admin).expect(200);
        expect(order.body.status).toBe('ACTIVE');
        expect(await lots()).toEqual([
          expect.objectContaining({
            units_total: SMS_COUNT,
            remaining: SMS_COUNT,
            status: 'ACTIVE',
          }),
        ]);
        // A replay of the same callback changes nothing.
        await supertest(app.getHttpServer())
          .get('/api/v1/billing/bkash/callback')
          .query({ paymentID, status: 'success' })
          .expect(302);
        expect(await lots()).toHaveLength(1);
        const [{ n }] = await dataSource.query(
          `SELECT count(*)::int AS n FROM platform_payments WHERE bundle_order_id = $1`,
          [orderId],
        );
        expect(n).toBe(1);
      },
    );

    await step('a send takes one unit from the lot (DEBIT)', async () => {
      const credits = app.get(SmsCreditService);
      await credits.reserve(TENANT_ID, 1, `batch:${sendRef}`, { type: 'batch', id: sendRef });
      await credits.settle(TENANT_ID, `batch:${sendRef}`, 'DEBIT');
      expect(await ledgerKinds()).toContain('DEBIT');
      expect(await lots()).toEqual([
        expect.objectContaining({ remaining: SMS_COUNT - 1, debited_units: 1 }),
      ]);
    });

    await step('oversold stops a new buy but never a send', async () => {
      await dataSource.query(`INSERT INTO sms_provider_balance_readings (sms_balance) VALUES (5)`);
      try {
        const refused = await call('post', 'sms-bundles/orders', tokens.admin)
          .send({ package_id: PACKAGE_ID, idempotency_key: crypto.randomUUID() })
          .expect(409);
        expect(JSON.stringify(refused.body)).toContain('SMS_SALES_PAUSED');
        const credits = app.get(SmsCreditService);
        await expect(
          credits.reserve(TENANT_ID, 1, `batch:${overRef}`, {
            type: 'batch',
            id: overRef,
          }),
        ).resolves.toEqual({ ok: true });
        await credits.settle(TENANT_ID, `batch:${overRef}`, 'RELEASE');
      } finally {
        await dataSource.query(`DELETE FROM sms_provider_balance_readings`);
      }
    });

    await step(
      'the expiry job after the validity ends turns what is left into EXPIRE',
      async () => {
        const when = new Date(Date.now() + 31 * 24 * 3600 * 1000);
        await app.get(SmsExpiryService).run(when);
        expect(await ledgerKinds()).toContain('EXPIRE');
        expect(await lots()).toEqual([
          expect.objectContaining({
            remaining: 0,
            expired_units: SMS_COUNT - 1,
            status: 'EXPIRED',
          }),
        ]);
      },
    );

    await step('switching back to OWN keeps the own provider and drops metering', async () => {
      await dataSource.query(
        `UPDATE schools SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{communications,sms}',
           '{"source":"SCHOOLMANAGERP","metering":"PLATFORM","twilio":{"accountSid":"x"}}'::jsonb, true)
         WHERE id = $1`,
        [TENANT_ID],
      );
      const res = await call('put', 'communications/sms-source', tokens.admin)
        .send({ source: 'OWN' })
        .expect(200);
      expect(res.body.source).toBe('OWN');
      const [row] = await dataSource.query(`SELECT settings FROM schools WHERE id = $1`, [
        TENANT_ID,
      ]);
      expect(row.settings.communications.sms).toMatchObject({
        source: 'OWN',
        metering: 'OFF',
        twilio: { accountSid: 'x' },
      });
    });

    await step("another school never reads this school's orders", async () => {
      const res = await call('get', `sms-bundles/orders/${orderId}`, tokens.admin, OTHER_TENANT_ID);
      expect([401, 403, 404]).toContain(res.status);
    });
  });
});
