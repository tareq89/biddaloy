import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { SEED_TENANT_ID } from '@test/constants';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { createProofFixture } from '@test/helpers/proof-submissions.fixture';
import { AppModule } from '../../app.module';
import { BkashClient } from '../payment-gateways/bkash/bkash.client';
import { SchoolsService } from '../schools/schools.service';
import { StorageService } from '../storage/storage.service';
import { OnlinePaymentsReconciler } from './online-payments.reconciler';
import { PAYMENT_SUBMISSION_EVENTS, paymentSubmissionEvents } from './payment-submission.events';

class FakeStorage {
  async put() {}
  async deleteForTenant() {}
}

const SECRET = 'sekret-app-secret-value';

/** [3.6.02] Online payments reconciler against the real database; BkashClient is a mock. */
describe('OnlinePaymentsReconciler (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let rec: OnlinePaymentsReconciler;
  let fix: Awaited<ReturnType<typeof createProofFixture>>;
  const query = vi.fn();
  const settings = vi.fn();
  const logs: string[] = [];
  const otherTenant = randomUUID();

  const goodSettings = {
    payments: {
      onlineEnabled: true,
      bkash: {
        environment: 'SANDBOX',
        appKey: 'k',
        appSecret: SECRET,
        username: 'u',
        password: 'p',
      },
    },
  };

  /** One ONLINE PENDING submission for a fresh bill. `ageMin` = minutes since created. */
  const online = async (
    opts: {
      ageMin?: number;
      paymentId?: string | null;
      amount?: number;
      status?: 'PENDING' | 'EXPIRED' | 'CANCELLED';
    } = {},
  ) => {
    const amount = opts.amount ?? 500;
    const bill = await fix.bill(fix.fx.studentA, amount);
    const paymentId = opts.paymentId === undefined ? `PID-${randomUUID()}` : opts.paymentId;
    const [s] = await ds.query(
      `INSERT INTO payment_submissions (tenant_id, source, status, submitted_by_user_id, amount,
         provider, environment, provider_payment_id, created_at, updated_at)
       VALUES ($1,'ONLINE',$6,$2,$3,'BKASH','SANDBOX',$4, now() - ($5 || ' minutes')::interval, now())
       RETURNING id`,
      [
        SEED_TENANT_ID,
        fix.parent.id,
        amount,
        paymentId,
        String(opts.ageMin ?? 5),
        opts.status ?? 'PENDING',
      ],
    );
    await ds.query(
      `INSERT INTO payment_submission_bills (tenant_id, submission_id, student_fee_id, student_id, amount_at_start)
       VALUES ($1,$2,$3,$4,$5)`,
      [SEED_TENANT_ID, s.id, bill, fix.fx.studentA, amount],
    );
    return s.id as string;
  };
  const row = async (id: string) =>
    (
      await ds.query(`SELECT status, provider_trx_id FROM payment_submissions WHERE id=$1`, [id])
    )[0];
  const payments = async () =>
    (await ds.query(`SELECT COUNT(*)::int n FROM payments WHERE tenant_id=$1`, [SEED_TENANT_ID]))[0]
      .n as number;
  const completed = async (id: string, amount = '500.00', over: Record<string, unknown> = {}) => ({
    transactionStatus: 'Completed',
    paymentID: (
      await ds.query(`SELECT provider_payment_id p FROM payment_submissions WHERE id=$1`, [id])
    )[0].p,
    currency: 'BDT',
    amount,
    merchantInvoiceNumber: id,
    trxID: `TRX${id.slice(0, 8)}`,
    ...over,
  });

  const scrub = async () => {
    await ds.query(`DELETE FROM payment_submissions WHERE tenant_id = ANY($1)`, [
      [SEED_TENANT_ID, otherTenant],
    ]);
    await ds.query(
      `DELETE FROM payment_allocations WHERE payment_id IN (SELECT id FROM payments WHERE tenant_id = $1)`,
      [SEED_TENANT_ID],
    );
    await ds.query(
      `UPDATE payments SET reversed_by_payment_id = NULL, reversal_of_payment_id = NULL WHERE tenant_id = $1`,
      [SEED_TENANT_ID],
    );
    await ds.query(`UPDATE invoices SET payment_id = NULL WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM payments WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(`DELETE FROM invoices WHERE tenant_id = $1`, [SEED_TENANT_ID]);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StorageService)
      .useClass(FakeStorage)
      .overrideProvider(BkashClient)
      .useValue({ query, isConfigured: () => false })
      .compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    await app.init();
    ds = app.get(DataSource);
    rec = app.get(OnlinePaymentsReconciler);
    vi.spyOn(app.get(SchoolsService), 'getDecryptedSettings').mockImplementation(settings as never);
    for (const m of ['log', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(Logger.prototype, m).mockImplementation((msg: unknown) => {
        logs.push(String(msg));
      });
    }
    fix = await createProofFixture(app, ds);
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1,'Other',$2,now(),now())`,
      [otherTenant, `other-${otherTenant.slice(0, 8)}`],
    );
  }, 120000);

  afterAll(async () => {
    await scrub();
    await ds?.query(`DELETE FROM schools WHERE id = $1`, [otherTenant]);
    await fix?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    await scrub();
    await fix.reset();
    query.mockReset();
    settings.mockReset();
    settings.mockImplementation(async (id: string) =>
      id === SEED_TENANT_ID ? goodSettings : { payments: { onlineEnabled: false } },
    );
    logs.length = 0;
  });

  it('lost callback: Completed with matching amount and invoice is settled once', async () => {
    const id = await online();
    query.mockResolvedValue(await completed(id));
    await rec.process();
    expect((await row(id)).status).toBe('COMPLETED');
    expect((await row(id)).provider_trx_id).toBe(`TRX${id.slice(0, 8)}`);
    expect(await payments()).toBe(1);
    // already-settled row is a no-op: a second run creates no second Payment
    await rec.process();
    expect(await payments()).toBe(1);
  });

  it('31-min submission never started at bKash is EXPIRED with an event; 5-min one is left', async () => {
    const old = await online({ ageMin: 31, paymentId: null });
    const fresh = await online({ ageMin: 5, paymentId: null });
    await rec.process();
    expect((await row(old)).status).toBe('EXPIRED');
    expect((await row(fresh)).status).toBe('PENDING');
    const ev = await ds.query(
      `SELECT to_status, reason_code FROM payment_submission_events WHERE submission_id=$1`,
      [old],
    );
    expect(ev).toEqual([{ to_status: 'EXPIRED', reason_code: 'NOT_STARTED' }]);
    expect(query).not.toHaveBeenCalled();
  });

  it('73-h submission is left alone, counted once in the log, and nothing is decrypted or called', async () => {
    const id = await online({ ageMin: 73 * 60 });
    await rec.process();
    await rec.process(); // the same count is not warned about again
    expect((await row(id)).status).toBe('PENDING');
    expect(query).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();
    expect(
      logs.filter((l) => l.includes('1 online submissions') && l.includes('72 h')),
    ).toHaveLength(1);
  });

  it.each(['PENDING', 'EXPIRED', 'CANCELLED'] as const)(
    '%s row: wrong currency or wrong paymentID is not settled',
    async (status) => {
      const id = await online({ status, ageMin: status === 'PENDING' ? 5 : 60 });
      query.mockResolvedValue(await completed(id, '500.00', { currency: 'USD' }));
      await rec.process();
      query.mockResolvedValue(await completed(id, '500.00', { paymentID: 'OTHER' }));
      await rec.process();
      expect((await row(id)).status).toBe(status);
      expect(await payments()).toBe(0);
    },
  );

  it('late payment: EXPIRED row with a paymentID, under 72 h, is settled once (settle accepts EXPIRED)', async () => {
    const id = await online({ status: 'EXPIRED', ageMin: 60 });
    query.mockResolvedValue(await completed(id));
    const emitted: string[] = [];
    const on = (p: { submissionId: string }) => emitted.push(p.submissionId);
    paymentSubmissionEvents.on(PAYMENT_SUBMISSION_EVENTS.COMPLETED, on);
    try {
      await rec.process();
      await rec.process();
    } finally {
      paymentSubmissionEvents.off(PAYMENT_SUBMISSION_EVENTS.COMPLETED, on);
    }
    expect((await row(id)).status).toBe('COMPLETED');
    expect(await payments()).toBe(1);
    expect(emitted).toEqual([id]); // one COMPLETED for one settlement
    const ev = await ds.query(
      `SELECT from_status, to_status FROM payment_submission_events WHERE submission_id=$1`,
      [id],
    );
    expect(ev).toEqual([{ from_status: 'EXPIRED', to_status: 'COMPLETED' }]);
  });

  it('EXPIRED rows stay put when bKash did not complete, or the payment is old or never started', async () => {
    const failed = await online({ status: 'EXPIRED', ageMin: 60 });
    const old = await online({ status: 'EXPIRED', ageMin: 73 * 60 });
    const unstarted = await online({ status: 'EXPIRED', ageMin: 60, paymentId: null });
    query.mockImplementation(async (pid: string) =>
      pid === (await pidOf(failed)) ? { transactionStatus: 'Failed' } : completed(old),
    );
    await rec.process();
    for (const id of [failed, old, unstarted]) expect((await row(id)).status).toBe('EXPIRED');
    expect(query).toHaveBeenCalledTimes(1); // only the young one with a paymentID
    expect(await payments()).toBe(0);
  });

  it('late payment: CANCELLED row with a paymentID, under 72 h, is settled once; a rerun adds no second payment', async () => {
    const id = await online({ status: 'CANCELLED', ageMin: 60 });
    query.mockResolvedValue(await completed(id));
    await rec.process();
    await rec.process();
    expect((await row(id)).status).toBe('COMPLETED');
    expect(await payments()).toBe(1);
  });

  it('CANCELLED rows stay put when bKash did not complete, or the payment is old or never started', async () => {
    const failed = await online({ status: 'CANCELLED', ageMin: 60 });
    const old = await online({ status: 'CANCELLED', ageMin: 73 * 60 });
    const unstarted = await online({ status: 'CANCELLED', ageMin: 60, paymentId: null });
    query.mockImplementation(async (pid: string) =>
      pid === (await pidOf(failed)) ? { transactionStatus: 'Failed' } : completed(old),
    );
    await rec.process();
    for (const id of [failed, old, unstarted]) expect((await row(id)).status).toBe('CANCELLED');
    expect(query).toHaveBeenCalledTimes(1);
    expect(await payments()).toBe(0);
  });

  it('late CANCELLED payment with a wrong amount or another invoice is not settled', async () => {
    const id = await online({ status: 'CANCELLED', ageMin: 60 });
    query.mockResolvedValue(await completed(id, '499.99'));
    await rec.process();
    query.mockResolvedValue(await completed(id, '500.00', { merchantInvoiceNumber: randomUUID() }));
    await rec.process();
    expect((await row(id)).status).toBe('CANCELLED');
    expect(await payments()).toBe(0);
  });

  it('a CANCELLED row of another tenant is never asked while this tenant is reconciled', async () => {
    await ds.query(
      `INSERT INTO payment_submissions (tenant_id, source, status, submitted_by_user_id, amount,
         provider, environment, provider_payment_id) VALUES ($1,'ONLINE','CANCELLED',$2,10,'BKASH','SANDBOX','PID-A')`,
      [otherTenant, fix.parent.id],
    );
    const id = await online({ status: 'CANCELLED', ageMin: 60 });
    query.mockResolvedValue(await completed(id));
    await rec.process();
    expect((await row(id)).status).toBe('COMPLETED');
    expect(
      query.mock.calls.every((c) => c[1].tenantId === SEED_TENANT_ID || c[0] === 'PID-A'),
    ).toBe(true);
    const [a] = await ds.query(`SELECT status FROM payment_submissions WHERE tenant_id=$1`, [
      otherTenant,
    ]);
    expect(a.status).toBe('CANCELLED');
  });

  it('late EXPIRED payment with a wrong amount is not settled', async () => {
    const id = await online({ status: 'EXPIRED', ageMin: 60 });
    query.mockResolvedValue(await completed(id, '499.99'));
    await rec.process();
    expect((await row(id)).status).toBe('EXPIRED');
    expect(await payments()).toBe(0);
  });

  it('gateway creds hold exactly the five bKash fields plus the tenant id', async () => {
    const id = await online();
    settings.mockImplementation(async () => ({
      payments: { ...goodSettings.payments, bkash: { ...goodSettings.payments.bkash, extra: 'x' } },
    }));
    query.mockResolvedValue(await completed(id));
    await rec.process();
    expect(Object.keys(query.mock.calls[0][1]).sort()).toEqual(
      ['appKey', 'appSecret', 'environment', 'password', 'tenantId', 'username'].sort(),
    );
  });

  it('tenant A error does not block tenant B; query gets B own tenantId; A rows untouched', async () => {
    await ds.query(
      `INSERT INTO payment_submissions (tenant_id, source, status, submitted_by_user_id, amount,
         provider, environment, provider_payment_id) VALUES ($1,'ONLINE','PENDING',$2,10,'BKASH','SANDBOX','PID-A')`,
      [otherTenant, fix.parent.id],
    );
    settings.mockImplementation(async (id: string) => {
      if (id === otherTenant) throw new Error('boom');
      return goodSettings;
    });
    const id = await online();
    query.mockResolvedValue(await completed(id));
    await rec.process();
    expect((await row(id)).status).toBe('COMPLETED');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1].tenantId).toBe(SEED_TENANT_ID);
    const [a] = await ds.query(`SELECT status FROM payment_submissions WHERE tenant_id=$1`, [
      otherTenant,
    ]);
    expect(a.status).toBe('PENDING');
  });

  it('Failed and Cancelled both become FAILED with distinct reason codes', async () => {
    const f = await online();
    const c = await online();
    query.mockImplementation(async (pid: string) => ({
      transactionStatus: pid === (await pidOf(f)) ? 'Failed' : 'Cancelled',
    }));
    await rec.process();
    expect((await row(f)).status).toBe('FAILED');
    expect((await row(c)).status).toBe('FAILED');
    const reason = async (id: string) =>
      (
        await ds.query(`SELECT reason_code FROM payment_submission_events WHERE submission_id=$1`, [
          id,
        ])
      )[0].reason_code;
    expect(await reason(f)).toBe('GATEWAY_FAILED');
    expect(await reason(c)).toBe('GATEWAY_CANCELLED');
  });
  const pidOf = async (id: string) =>
    (await ds.query(`SELECT provider_payment_id p FROM payment_submissions WHERE id=$1`, [id]))[0]
      .p as string;

  it('bKash down leaves PENDING; the next run settles', async () => {
    const id = await online();
    query.mockRejectedValueOnce(new Error('network'));
    await rec.process();
    expect((await row(id)).status).toBe('PENDING');
    query.mockResolvedValue(await completed(id));
    await rec.process();
    expect((await row(id)).status).toBe('COMPLETED');
  });

  it('batch cap: 101 pending rows, exactly 100 queried', async () => {
    const id = await online();
    await ds.query(
      `INSERT INTO payment_submissions (tenant_id, source, status, submitted_by_user_id, amount,
         provider, environment, provider_payment_id)
       SELECT $1,'ONLINE','PENDING',$2,10,'BKASH','SANDBOX','PID-'||g FROM generate_series(1,100) g`,
      [SEED_TENANT_ID, fix.parent.id],
    );
    expect(id).toBeTruthy();
    query.mockResolvedValue({ transactionStatus: 'Initiated' });
    await rec.process();
    expect(query).toHaveBeenCalledTimes(100);
  });

  it('amount or invoice mismatch is not settled', async () => {
    const a = await online();
    const b = await online();
    query.mockImplementation(async (pid: string) =>
      pid === (await pidOf(a))
        ? completed(a, '499.99')
        : { ...(await completed(b)), merchantInvoiceNumber: randomUUID() },
    );
    await rec.process();
    expect((await row(a)).status).toBe('PENDING');
    expect((await row(b)).status).toBe('PENDING');
    expect(await payments()).toBe(0);
  });

  it('onlineEnabled=false or incomplete creds: skipped, bKash not called', async () => {
    const id = await online();
    settings.mockResolvedValue({ payments: { onlineEnabled: false } });
    await rec.process();
    settings.mockResolvedValue({
      payments: { onlineEnabled: true, bkash: { environment: 'SANDBOX', appKey: 'k' } },
    });
    await rec.process();
    expect(query).not.toHaveBeenCalled();
    expect((await row(id)).status).toBe('PENDING');
  });

  it('logs carry no credentials and no raw bKash body', async () => {
    const id = await online();
    query.mockResolvedValue({ ...(await completed(id, '1.00')), raw: 'RAW-BKASH-BODY' });
    await rec.process(); // mismatch path logs a warning
    query.mockRejectedValue(new Error(`${SECRET} RAW-BKASH-BODY`));
    await rec.process();
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) {
      expect(l).not.toContain(SECRET);
      expect(l).not.toContain('RAW-BKASH-BODY');
    }
  });
});
