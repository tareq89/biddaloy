import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentGatewayEnvironment, UserRole } from '@biddaloy/shared';
import { SEED_TENANT_ID } from '@test/constants';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { createProofFixture } from '@test/helpers/proof-submissions.fixture';
import { AppModule } from '../../app.module';
import { BkashClient } from '../payment-gateways/bkash/bkash.client';
import { PaymentSubmissionSettlement } from '../fees/payment-submission-settlement.service';
import { SchoolsService } from '../schools/schools.service';
import { OnlinePaymentsService } from './online-payments.service';
import { ProofCaller } from './proof-submissions.service';
import { PAYMENT_SUBMISSION_EVENTS, paymentSubmissionEvents } from './payment-submission.events';
import { AuditService } from '../audit/audit.service';
import { syncSubmissionsOnReversal } from './sync-submissions-on-reversal';

/** Stub provider: no live bKash. Each test sets what bKash "answers". */
class StubBkash {
  static paymentID = 'PAY1';
  static executeAnswer: Record<string, unknown> | null = null;
  static createFails = false;
  static executes = 0;
  /** Billing's reconciler asks at boot; false keeps it idle. */
  isConfigured() {
    return false;
  }
  testConnection = vi.fn(async () => undefined);
  async create() {
    if (StubBkash.createFails) throw new Error('bkash down');
    return {
      statusCode: '0000',
      paymentID: StubBkash.paymentID,
      bkashURL: `https://pay.example/${StubBkash.paymentID}`,
    };
  }
  async execute() {
    StubBkash.executes += 1;
    return StubBkash.executeAnswer ?? { statusCode: '2062' };
  }
  async query() {
    return StubBkash.executeAnswer ?? { statusCode: '2062' };
  }
}

const CREDS = {
  payments: {
    bkash: {
      environment: PaymentGatewayEnvironment.SANDBOX,
      appKey: 'k',
      appSecret: 's',
      username: 'u',
      password: 'p',
    },
  },
};

/** [3.x/#3984] bKash start + callback trust model against the real database, provider stubbed. */
describe('OnlinePaymentsService (integration)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let svc: OnlinePaymentsService;
  let fix: Awaited<ReturnType<typeof createProofFixture>>;
  let ctx: ProofCaller;

  const setOnline = (on: boolean) =>
    ds.query(
      `UPDATE schools SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{payments,onlineEnabled}', $2::jsonb, true) WHERE id = $1`,
      [SEED_TENANT_ID, JSON.stringify(on)],
    );
  /** What bKash says for a finished payment of `amount` for submission `id`. */
  const completed = (id: string, amount: string, over: Record<string, unknown> = {}) => ({
    statusCode: '0000',
    transactionStatus: 'Completed',
    paymentID: StubBkash.paymentID,
    trxID: `TRX${StubBkash.paymentID}`,
    amount,
    currency: 'BDT',
    merchantInvoiceNumber: id,
    ...over,
  });
  const sub = async (id: string) =>
    (await ds.query(`SELECT * FROM payment_submissions WHERE id = $1`, [id]))[0];
  const paymentCount = async (id: string) =>
    (
      await ds.query(
        `SELECT COUNT(DISTINCT payment_id)::int n FROM payment_submission_bills WHERE submission_id = $1`,
        [id],
      )
    )[0].n as number;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BkashClient)
      .useClass(StubBkash)
      .compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    await app.init();
    ds = app.get(DataSource);
    svc = app.get(OnlinePaymentsService);
    fix = await createProofFixture(app, ds);
    ctx = { tenantId: SEED_TENANT_ID, userId: fix.parent.id, role: UserRole.PARENT };
    // Creds are encrypted at rest; the stub path only needs plain values from the decrypted view.
    const schools = app.get(SchoolsService);
    const real = schools.getDecryptedSettings.bind(schools);
    vi.spyOn(schools, 'getDecryptedSettings').mockImplementation(async (id: string) => {
      const base = await real(id);
      return { ...base, payments: { ...base.payments, ...CREDS.payments } } as never;
    });
  }, 120000);

  afterAll(async () => {
    await fix?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    StubBkash.paymentID = `PAY${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    StubBkash.executeAnswer = null;
    StubBkash.createFails = false;
    StubBkash.executes = 0;
    await fix.reset();
    await setOnline(true);
  });

  it('happy path, two children: one payment per child, submission COMPLETED, trxID kept', async () => {
    await fix.linkParentTo(fix.fx.studentB);
    const a = await fix.bill(fix.fx.studentA, 500);
    const b = await fix.bill(fix.fx.studentB, 250.5, 50); // balance 200.50
    const started = await svc.start({ billIds: [a, b] }, ctx);
    expect(started.bkashUrl).toContain(StubBkash.paymentID);
    StubBkash.executeAnswer = completed(started.id, '700.50');
    expect(await svc.handleCallback(StubBkash.paymentID, 'success')).toBe(started.id);
    const s = await sub(started.id);
    expect(s.status).toBe('COMPLETED');
    expect(s.provider_trx_id).toBe(`TRX${StubBkash.paymentID}`);
    expect(await paymentCount(started.id)).toBe(2);
    // [#3997 D22] The result names each child's receipt (the invoice number) and when it was paid.
    const done = await svc.result(started.id, ctx);
    const invoices = await ds.query(
      `SELECT i.id, i.invoice_number FROM payment_submission_bills b
         JOIN payments p ON p.id = b.payment_id JOIN invoices i ON i.id = p.invoice_id
        WHERE b.submission_id = $1`,
      [started.id],
    );
    expect(done.receipts).toHaveLength(2);
    expect(done.receipts.map((r) => r.receiptNo).sort()).toEqual(
      invoices.map((r: { invoice_number: string }) => r.invoice_number).sort(),
    );
    expect(done.paidAt).toBeInstanceOf(Date);
  });

  it('a guardian not linked to any child on the payment gets a 404, so no receipt leaks', async () => {
    const a = await fix.bill(fix.fx.studentA, 300);
    const started = await svc.start({ billIds: [a] }, ctx);
    const stranger = { ...ctx, userId: '00000000-0000-4000-8000-000000000001' };
    await expect(svc.result(started.id, stranger)).rejects.toThrow();
  });

  it('a payment that is still PENDING has no receipts and no paid date', async () => {
    const a = await fix.bill(fix.fx.studentA, 300);
    const started = await svc.start({ billIds: [a] }, ctx);
    const r = await svc.result(started.id, ctx);
    expect(r).toMatchObject({ status: 'PENDING', receipts: [], paidAt: null });
  });

  it('amount mismatch at bKash: no payment is made', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = completed(id, '499.99');
    await svc.handleCallback(StubBkash.paymentID, 'success');
    expect((await sub(id)).status).toBe('FAILED');
    expect(await paymentCount(id)).toBe(0);
  });

  it('a different merchantInvoiceNumber is refused even when Completed', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = completed(id, '500.00', {
      merchantInvoiceNumber: '00000000-0000-4000-8000-000000000001',
    });
    await svc.handleCallback(StubBkash.paymentID, 'success');
    expect((await sub(id)).status).toBe('FAILED');
    expect(await paymentCount(id)).toBe(0);
  });

  it('the URL saying success is not believed when bKash does not say Completed', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = { statusCode: '0000', transactionStatus: 'Initiated' };
    await svc.handleCallback(StubBkash.paymentID, 'success');
    expect((await sub(id)).status).toBe('PENDING'); // non-terminal at bKash: wait, never pay
    expect(await paymentCount(id)).toBe(0);
  });

  it('bKash reporting Cancelled closes the submission as CANCELLED with an event', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = { statusCode: '0000', transactionStatus: 'Cancelled' };
    await svc.handleCallback(StubBkash.paymentID, 'cancel');
    expect((await sub(id)).status).toBe('CANCELLED');
    const ev = await ds.query(
      `SELECT reason_code FROM payment_submission_events WHERE submission_id=$1 AND to_status='CANCELLED'`,
      [id],
    );
    expect(ev[0].reason_code).toBe('BKASH_CANCELLED');
  });

  it('a hostile URL status never closes the row; a later Completed callback still settles', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = { statusCode: '0000', transactionStatus: 'Initiated' };
    await svc.handleCallback(StubBkash.paymentID, 'failure');
    await svc.handleCallback(StubBkash.paymentID, 'cancel');
    expect((await sub(id)).status).toBe('PENDING');
    StubBkash.executeAnswer = completed(id, '500.00');
    await svc.handleCallback(StubBkash.paymentID, 'success');
    expect((await sub(id)).status).toBe('COMPLETED');
    expect(await paymentCount(id)).toBe(1);
  });

  it('paying after the row expired still settles', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    await ds.query(`UPDATE payment_submissions SET status='EXPIRED' WHERE id=$1`, [id]);
    StubBkash.executeAnswer = completed(id, '500.00');
    await svc.handleCallback(StubBkash.paymentID, 'success');
    expect((await sub(id)).status).toBe('COMPLETED');
    expect(await paymentCount(id)).toBe(1);
  });

  it('two callbacks at once book one payment', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = completed(id, '500.00');
    const emitted: string[] = [];
    const on = (p: { submissionId: string }) => emitted.push(p.submissionId);
    paymentSubmissionEvents.on(PAYMENT_SUBMISSION_EVENTS.COMPLETED, on);
    // Latch: both callbacks are held at the settlement boundary until both have arrived, then
    // released together, so the race is real and not left to Promise.all timing.
    const settlement = app.get(PaymentSubmissionSettlement);
    const realSettle = settlement.settle.bind(settlement);
    let arrived = 0;
    let release!: () => void;
    const bothArrived = new Promise<void>((r) => (release = r));
    const spy = vi.spyOn(settlement, 'settle').mockImplementation(async (...args) => {
      if (++arrived === 2) release();
      await bothArrived;
      return realSettle(...args);
    });
    try {
      await Promise.all([
        svc.handleCallback(StubBkash.paymentID, 'success'),
        svc.handleCallback(StubBkash.paymentID, 'success'),
      ]);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
      paymentSubmissionEvents.off(PAYMENT_SUBMISSION_EVENTS.COMPLETED, on);
    }
    expect((await sub(id)).status).toBe('COMPLETED');
    expect(await paymentCount(id)).toBe(1);
    // One settlement: one COMPLETED event on the bus and one history row.
    expect(emitted).toEqual([id]);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int n FROM payment_submission_events WHERE submission_id=$1 AND to_status='COMPLETED'`,
      [id],
    );
    expect(n).toBe(1);
  });

  it('reversing the payment of a settled ONLINE submission marks it REVERSED, like a proof', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = completed(id, '500.00');
    await svc.handleCallback(StubBkash.paymentID, 'success');
    const [{ payment_id }] = await ds.query(
      `SELECT payment_id FROM payment_submission_bills WHERE submission_id=$1`,
      [id],
    );
    const touched = await ds.transaction((m) =>
      syncSubmissionsOnReversal(m, app.get(AuditService), {
        tenantId: SEED_TENANT_ID,
        paymentId: payment_id,
        actorUserId: fix.parent.id,
        reason: 'test',
      }),
    );
    expect(touched).toEqual([id]);
    expect((await sub(id)).status).toBe('REVERSED');
  });

  it('mismatch leaves a durable MISMATCH event', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = completed(id, '1.00');
    await svc.handleCallback(StubBkash.paymentID, 'success');
    const ev = await ds.query(
      `SELECT reason_code FROM payment_submission_events WHERE submission_id=$1 AND to_status='FAILED'`,
      [id],
    );
    expect(ev[0].reason_code).toBe('MISMATCH');
  });

  it('callback replay books one payment and calls bKash once', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    StubBkash.executeAnswer = completed(id, '500.00');
    await svc.handleCallback(StubBkash.paymentID, 'success');
    await svc.handleCallback(StubBkash.paymentID, 'success');
    expect(StubBkash.executes).toBe(1);
    expect(await paymentCount(id)).toBe(1);
  });

  it('unknown or malformed paymentID: no bKash call, nothing changes', async () => {
    expect(await svc.handleCallback('NOPE-UNKNOWN', 'success')).toBeUndefined();
    expect(StubBkash.executes).toBe(0);
    await expect(svc.handleCallback('bad id!', 'success')).rejects.toThrow('Invalid callback');
    await expect(svc.handleCallback(undefined, 'success')).rejects.toThrow('Invalid callback');
  });

  it('bill paid meanwhile: the money goes to the wallet and the submission is unmatched (D12)', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const { id } = await svc.start({ billIds: [a] }, ctx);
    await ds.query(
      `UPDATE student_fees SET paid_amount = total_amount, status = 'PAID' WHERE id = $1`,
      [a],
    );
    StubBkash.executeAnswer = completed(id, '500.00');
    await svc.handleCallback(StubBkash.paymentID, 'success');
    const s = await sub(id);
    expect(s.status).toBe('COMPLETED');
    expect(s.unmatched).toBe(true);
    const [w] = await ds.query(
      `SELECT COALESCE(SUM(balance),0)::text b FROM student_wallets WHERE student_id = $1`,
      [fix.fx.studentA],
    );
    expect(Number(w.b)).toBe(500);
  });

  it('a bill in a waiting proof refuses the start (D24)', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    const [p] = await ds.query(
      `INSERT INTO payment_submissions (tenant_id, source, status, submitted_by_user_id, method, amount, paid_on)
       VALUES ($1,'PROOF','PENDING',$2,'BKASH',500,'2000-01-01') RETURNING id`,
      [SEED_TENANT_ID, fix.parent.id],
    );
    await ds.query(
      `INSERT INTO payment_submission_bills (tenant_id, submission_id, student_fee_id, student_id, amount_at_start)
       VALUES ($1,$2,$3,$4,500)`,
      [SEED_TENANT_ID, p.id, a, fix.fx.studentA],
    );
    await expect(svc.start({ billIds: [a] }, ctx)).rejects.toThrow('cannot take a payment');
  });

  it('online switched off: refused, nothing written', async () => {
    await setOnline(false);
    const a = await fix.bill(fix.fx.studentA, 500);
    await expect(svc.start({ billIds: [a] }, ctx)).rejects.toThrow(
      'Online payment is not available',
    );
    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int n FROM payment_submissions WHERE tenant_id=$1`,
      [SEED_TENANT_ID],
    );
    expect(n).toBe(0);
  });

  it('gateway down at start: 503 fixed sentence, submission FAILED so the bill is free again', async () => {
    const a = await fix.bill(fix.fx.studentA, 500);
    StubBkash.createFails = true;
    await expect(svc.start({ billIds: [a] }, ctx)).rejects.toThrow(
      'Online payment is not available right now',
    );
    const [s] = await ds.query(`SELECT status FROM payment_submissions WHERE tenant_id=$1`, [
      SEED_TENANT_ID,
    ]);
    expect(s.status).toBe('FAILED');
    StubBkash.createFails = false;
    await expect(svc.start({ billIds: [a] }, ctx)).resolves.toBeDefined();
  });

  it('another family bill is a 404', async () => {
    const theirs = await fix.bill(fix.fx.studentB, 200);
    await expect(svc.start({ billIds: [theirs] }, ctx)).rejects.toThrow('Bill not found');
  });

  it('test connection stamps lastTestOkAt and keeps the other payment settings', async () => {
    const res = await svc.testConnection(SEED_TENANT_ID);
    const [{ settings }] = await ds.query(`SELECT settings FROM schools WHERE id=$1`, [
      SEED_TENANT_ID,
    ]);
    expect(settings.payments.bkash.lastTestOkAt).toBe(res.lastTestOkAt);
    expect(settings.payments.onlineEnabled).toBe(true);
  });

  it('credentials changed while the test ran: no stamp', async () => {
    const stub = app.get(BkashClient) as unknown as StubBkash;
    stub.testConnection.mockImplementationOnce(async () => {
      await ds.query(
        `UPDATE schools SET settings = jsonb_set(COALESCE(settings,'{}'::jsonb), '{payments,bkash}', '{"appKey":"changed"}'::jsonb, true) WHERE id = $1`,
        [SEED_TENANT_ID],
      );
    });
    await svc.testConnection(SEED_TENANT_ID);
    const [{ settings }] = await ds.query(`SELECT settings FROM schools WHERE id=$1`, [
      SEED_TENANT_ID,
    ]);
    expect(settings.payments.bkash.appKey).toBe('changed');
    expect(settings.payments.bkash.lastTestOkAt).toBeUndefined();
  });
});
