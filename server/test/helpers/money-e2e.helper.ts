import supertest = require('supertest');
import { expect } from 'vitest';
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../src/app.module';
import { ApprovalGuard } from '../../src/modules/auth/guards/approval.guard';
import { BkashClient, paisaToBdt } from '../../src/modules/billing/bkash/bkash.client';
import { buildValidationPipeOptions } from '../../src/validation-pipe';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '../constants';
import { configureApiVersioning } from './e2e-app.helper';
import { mintCockpitToken } from './cockpit-token.helper';

export const API = '/api/v1';

export interface MoneySchool {
  id: string;
  adminId: string;
  email: string;
  token: string;
}

/**
 * bKash stand-in for the money e2e specs: no network, but `create`/`query`/`execute` answer from
 * the real order row, so the callback, `markPaid` and the lot behind them all run for real.
 */
export function makeBkashStub(ds: () => DataSource) {
  const started = new Map<string, string>();
  const amountOf = async (orderId: string): Promise<string> => {
    const [row] = await ds().query(
      `SELECT price_paisa::text AS p FROM sms_bundle_orders WHERE id = $1
       UNION ALL SELECT amount_paisa::text FROM seat_orders WHERE id = $1`,
      [orderId],
    );
    return paisaToBdt(row.p);
  };
  const stub = {
    isConfigured: () => true,
    started,
    create: async (o: { orderId: string }) => {
      const paymentID = `TR${randomUUID().replace(/-/g, '').slice(0, 12)}`;
      started.set(paymentID, o.orderId);
      return { statusCode: '0000', paymentID, bkashURL: `https://pay.example/${paymentID}` };
    },
    query: async (paymentID: string) => {
      const orderId = started.get(paymentID)!;
      return {
        statusCode: '0000',
        paymentID,
        trxID: `TRX${paymentID}`,
        transactionStatus: 'Completed',
        amount: await amountOf(orderId),
        currency: 'BDT',
        merchantInvoiceNumber: orderId,
      };
    },
    execute: async (paymentID: string) => stub.query(paymentID),
  };
  return stub;
}

export interface MoneyApp {
  app: INestApplication;
  ds: DataSource;
  bkash: ReturnType<typeof makeBkashStub>;
  ownerToken: string;
  http: () => ReturnType<typeof supertest>;
}

/**
 * The whole app with two stand-ins: bKash (no network) and the step-up `ApprovalGuard` (its own
 * 403 is pinned in platform-billing.controller.e2e-spec.ts; here it is only an OTP round trip in
 * front of the refund). `configure` lets a spec add more overrides before the app compiles.
 */
export async function bootMoneyApp(
  configure?: (b: ReturnType<typeof Test.createTestingModule>) => unknown,
): Promise<MoneyApp> {
  process.env.NODE_ENV = 'test';
  let ds!: DataSource;
  const bkash = makeBkashStub(() => ds);
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(BkashClient)
    .useValue(bkash)
    .overrideGuard(ApprovalGuard)
    .useValue({ canActivate: () => true });
  configure?.(builder);
  const fixture = await builder.compile();
  const app = fixture.createNestApplication();
  configureApiVersioning(app);
  app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
  await app.init();
  ds = app.get(DataSource);
  const ownerToken = await mintCockpitToken(app, ds);
  return { app, ds, bkash, ownerToken, http: () => supertest(app.getHttpServer()) };
}

/** A school with one ADMIN who can log in; `smsSource` switches it to SchoolManagerP metering. */
export async function createMoneySchool(
  m: Pick<MoneyApp, 'ds' | 'http'>,
  label: string,
  smsSource: 'OWN' | 'SCHOOLMANAGERP' = 'SCHOOLMANAGERP',
): Promise<MoneySchool> {
  const s: MoneySchool = {
    id: randomUUID(),
    adminId: randomUUID(),
    email: `${label}-${randomUUID().slice(0, 8)}@money-e2e.example`,
    token: '',
  };
  await m.ds.query(
    `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
    [s.id, `Money E2E ${s.id}`, `money-e2e-${s.id}`],
  );
  await m.ds.query(
    `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'Money E2E', 'ACTIVE', NOW(), NOW())`,
    [s.adminId, s.email, SEED_ADMIN_PASSWORD_HASH],
  );
  await m.ds.query(
    `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())`,
    [s.adminId, s.id, UserRole.ADMIN],
  );
  s.token = (
    await m
      .http()
      .post(`${API}/auth/login`)
      .send({ email: s.email, password: SEED_ADMIN_PASSWORD })
      .expect(200)
  ).body.access_token;
  if (smsSource === 'SCHOOLMANAGERP') {
    await m
      .http()
      .put(`${API}/communications/sms-source`)
      .set('Authorization', `Bearer ${s.token}`)
      .set('X-Tenant-ID', s.id)
      .send({ source: 'SCHOOLMANAGERP' })
      .expect(200);
  }
  return s;
}

/** An active catalog package (these tables are cleared before each `it`, so make it inside one). */
export async function insertPackage(
  ds: DataSource,
  smsCount = 100,
  pricePaisa = 300000,
  validityDays = 30,
): Promise<string> {
  const [row] = await ds.query(
    `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [`E2E ${randomUUID().slice(0, 6)}`, smsCount, validityDays, pricePaisa],
  );
  return row.id as string;
}

/**
 * The ledger invariant every money case ends on: the balance row equals what the lots hold,
 * available = sum of lot remainders, reserved = sum of reserved units.
 */
export async function expectLedgerInvariant(ds: DataSource, tenantId: string): Promise<void> {
  const [row] = await ds.query(
    `SELECT COALESCE((SELECT available FROM sms_credit_balance WHERE tenant_id = $1), 0)::int AS available,
            COALESCE((SELECT reserved FROM sms_credit_balance WHERE tenant_id = $1), 0)::int AS reserved,
            COALESCE((SELECT sum(remaining) FROM sms_credit_lots WHERE tenant_id = $1), 0)::int AS lot_remaining,
            COALESCE((SELECT sum(reserved_units) FROM sms_credit_lots WHERE tenant_id = $1), 0)::int AS lot_reserved`,
    [tenantId],
  );
  expect({ available: row.available, reserved: row.reserved }).toEqual({
    available: row.lot_remaining,
    reserved: row.lot_reserved,
  });
}
