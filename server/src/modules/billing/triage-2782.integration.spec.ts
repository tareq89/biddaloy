/**
 * Triage of #2782: ten unverified code-review findings in Epic 49 billing, one test each.
 * A test that passed on the unfixed code means NOT REAL (kept as a pinned behaviour).
 * Verdicts are in each test's comment. F1, F2 and F10 were REAL and fixed in bkash.service.ts;
 * F8 and F9 are REAL but live outside billing (pinned as today's behaviour, see their notes).
 */
import { randomUUID } from 'crypto';
import { Reflector } from '@nestjs/core';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PlatformPaymentMethod, SeatOrderStatus, UserRole } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_SECTION_1_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { TenantStatusService } from '../schools/tenant-status.service';
import { StudentService, GuardianService } from '../students/students.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { ContextGuard } from '../auth/guards/context.guard';
import { SchoolsService } from '../schools/schools.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { FeeController } from '../fees/fees.controller';
import { PrintJobsController } from '../print/jobs/print-jobs.controller';
import { BillingModule } from './billing.module';
import { EntitlementService } from './entitlement.service';
import { OrdersService } from './orders.service';
import { ReceiptService } from './receipt.service';
import { BkashService } from './bkash/bkash.service';
import { PlatformBillingService } from './platform-billing.service';
import { SeatNoticesService } from './seat-notices.service';

/** The few Redis calls BkashService makes, in memory. */
function fakeRedis() {
  const m = new Map<string, string>();
  return {
    set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && m.has(k)) return null;
      m.set(k, v);
      return 'OK';
    }),
    get: vi.fn(async (k: string) => m.get(k) ?? null),
    del: vi.fn(async (k: string) => (m.delete(k) ? 1 : 0)),
    exists: vi.fn(async (k: string) => (m.has(k) ? 1 : 0)),
  };
}

describe('#2782 triage (integration)', () => {
  let ds: DataSource;
  let orders: OrdersService;
  let entitlement: EntitlementService;
  let platform: PlatformBillingService;
  let audit: AuditService;
  const tenantStatus = { invalidate: vi.fn().mockResolvedValue(undefined) };
  const originalFreeUntil = process.env.BILLING_FREE_UNTIL;
  const schoolIds: string[] = [];

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      EntitlementService,
      OrdersService,
      StudentService,
      GuardianService,
      AuditService,
      { provide: TenantStatusService, useValue: tenantStatus },
      { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
      { provide: AdminNoticeService, useValue: { notifyAdmins: vi.fn() } },
      { provide: ReceiptService, useValue: { emailReceipt: vi.fn() } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    orders = module.get(OrdersService);
    entitlement = module.get(EntitlementService);
    audit = module.get(AuditService);
  }, 60000);

  afterEach(async () => {
    if (originalFreeUntil === undefined) delete process.env.BILLING_FREE_UNTIL;
    else process.env.BILLING_FREE_UNTIL = originalFreeUntil;
    tenantStatus.invalidate.mockClear();
    await ds.query('DELETE FROM students WHERE tenant_id = ANY($1)', [schoolIds]);
    await ds.query(
      'DELETE FROM platform_payments WHERE seat_order_id IN (SELECT id FROM seat_orders WHERE school_id = ANY($1))',
      [schoolIds],
    );
    await ds.query('DELETE FROM seat_orders WHERE school_id = ANY($1)', [schoolIds]);
  });

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  const afterCutoff = () => (process.env.BILLING_FREE_UNTIL = '2000-01-01T00:00:00+06:00');

  const newSchool = async (): Promise<string> => {
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Tri ${id.slice(0, 6)}`,
      slug: `tri-${id.slice(0, 8)}`,
    });
    schoolIds.push(id);
    return id;
  };
  const pending = async (schoolId: string, seats = 3) =>
    orders.createPending({
      schoolId,
      seats,
      months: 1,
      idempotency_key: randomUUID(),
      userId: null,
    });
  const statusOf = async (orderId: string) =>
    (await ds.query('SELECT status FROM seat_orders WHERE id = $1', [orderId]))[0].status;
  const addStudent = (tenantId: string) =>
    ds.query(
      `INSERT INTO students (tenant_id, full_name, registration_number, roll_number, class_section_id)
       VALUES ($1, 'Seat Holder', $2, 1, $3)`,
      [tenantId, `R-${randomUUID().slice(0, 8)}`, SEED_SECTION_1_ID],
    );

  /** BkashService on the real database, a stubbed bKash and in-memory Redis. */
  function bkashWorld() {
    const redis = fakeRedis();
    const client = { isConfigured: () => true, create: vi.fn(), execute: vi.fn(), query: vi.fn() };
    const svc = new BkashService(
      client as never,
      orders,
      { get: () => 'http://localhost:5174' } as never,
      ds,
      redis as never,
    );
    return { svc, client, redis };
  }
  const tx = (orderId: string, paymentID: string, status: string, amount = '30.00') => ({
    statusCode: '0000',
    paymentID,
    trxID: status === 'Completed' ? `TRX${paymentID}` : undefined,
    amount,
    currency: 'BDT',
    transactionStatus: status,
    merchantInvoiceNumber: orderId,
  });
  const created = (paymentID: string) => ({
    statusCode: '0000',
    paymentID,
    bkashURL: `https://pay/${paymentID}`,
  });

  it('F1 REAL (fixed): a second Pay does not orphan an earlier payment that completes late', async () => {
    afterCutoff();
    const o = await pending(await newSchool());
    const { svc, client } = bkashWorld();
    client.create.mockResolvedValueOnce(created('PAYA1')).mockResolvedValueOnce(created('PAYB1'));
    await svc.startPayment(schoolIds.at(-1)!, o.id);
    // "success" came back but bKash had not completed it: the URL is dropped, PAYA1 may still land.
    client.query.mockResolvedValue(tx(o.id, 'PAYA1', 'Initiated'));
    client.execute.mockResolvedValue(tx(o.id, 'PAYA1', 'Initiated'));
    await svc.handleCallback('PAYA1', 'success');
    await svc.startPayment(schoolIds.at(-1)!, o.id); // creates PAYB1
    // PAYA1 completes after all; the reconciler must still find it.
    client.query.mockImplementation(async (pid: string) =>
      tx(o.id, pid, pid === 'PAYA1' ? 'Completed' : 'Initiated'),
    );
    expect(await svc.reconcilePending()).toBe(1);
    expect(await statusOf(o.id)).toBe(SeatOrderStatus.PAID);
  }, 20000);

  it('F1 (callback side): the earlier payment id is still accepted on its own callback', async () => {
    afterCutoff();
    const sid = await newSchool();
    const o = await pending(sid);
    const { svc, client } = bkashWorld();
    client.create.mockResolvedValueOnce(created('PAYC1')).mockResolvedValueOnce(created('PAYD1'));
    await svc.startPayment(sid, o.id);
    client.query.mockResolvedValue(tx(o.id, 'PAYC1', 'Initiated'));
    client.execute.mockResolvedValue(tx(o.id, 'PAYC1', 'Initiated'));
    await svc.handleCallback('PAYC1', 'success');
    await svc.startPayment(sid, o.id);
    client.query.mockResolvedValue(tx(o.id, 'PAYC1', 'Completed'));
    expect((await svc.handleCallback('PAYC1', 'success')).outcome).toBe('success');
    expect(await statusOf(o.id)).toBe(SeatOrderStatus.PAID);
  }, 20000);

  /** Starts PAYx1 (never completed), then PAYx2: leaves earlier=[PAYx1]. */
  async function twoAttempts(prefix: string) {
    afterCutoff();
    const sid = await newSchool();
    const o = await pending(sid);
    const w = bkashWorld();
    w.client.create
      .mockResolvedValueOnce(created(`${prefix}1`))
      .mockResolvedValueOnce(created(`${prefix}2`));
    await w.svc.startPayment(sid, o.id);
    w.client.query.mockResolvedValue(tx(o.id, `${prefix}1`, 'Initiated'));
    w.client.execute.mockResolvedValue(tx(o.id, `${prefix}1`, 'Initiated'));
    await w.svc.handleCallback(`${prefix}1`, 'success');
    await w.svc.startPayment(sid, o.id);
    return { ...w, o, sid };
  }
  const orphans = (orderId: string) =>
    ds.query(
      `SELECT raw->>'orphan_reason' AS reason FROM platform_payments WHERE seat_order_id = $1 AND raw->>'orphan' = 'true'`,
      [orderId],
    );

  it('F1 review: both payments Completed -> one pays, the other is an ORDER_NOT_PENDING orphan', async () => {
    const { svc, client, o } = await twoAttempts('PAYH');
    client.query.mockImplementation(async (pid: string) => tx(o.id, pid, 'Completed'));
    await svc.reconcilePending();
    expect(await statusOf(o.id)).toBe(SeatOrderStatus.PAID);
    expect(await orphans(o.id)).toEqual([{ reason: 'ORDER_NOT_PENDING' }]);
  }, 20000);

  it('F1 review: a mismatching earlier payment does not stop the real one being settled', async () => {
    const { svc, client, o } = await twoAttempts('PAYI');
    client.query.mockImplementation(async (pid: string) =>
      pid === 'PAYI1' ? tx(o.id, pid, 'Completed', '1.00') : tx(o.id, pid, 'Completed'),
    );
    await svc.reconcilePending();
    expect(await statusOf(o.id)).toBe(SeatOrderStatus.PAID);
    expect(await orphans(o.id)).toEqual([{ reason: 'MISMATCH' }]);
  }, 20000);

  it('F1 review: state written before the fix (no dead / earlier) still reconciles and gates offline', async () => {
    afterCutoff();
    const o = await pending(await newSchool());
    const { svc, client, redis } = bkashWorld();
    await redis.set(`bkash:pid:PAYJ1`, o.id);
    await redis.set(
      `bkash:pay:${o.id}`,
      JSON.stringify({ paymentID: 'PAYJ1', pay_started_at: new Date().toISOString() }),
    );
    expect(await svc.paymentMayBeLive(o.id)).toBe(true);
    client.query.mockResolvedValue(tx(o.id, 'PAYJ1', 'Completed'));
    expect(await svc.reconcilePending()).toBe(1);
    expect(await statusOf(o.id)).toBe(SeatOrderStatus.PAID);
  });

  it('F1 review: an earlier payment completing after the order was paid offline is an orphan, never "success"', async () => {
    const { svc, client, o } = await twoAttempts('PAYK');
    await orders.markPaid(o.id, { method: PlatformPaymentMethod.OFFLINE_CASH });
    client.query.mockResolvedValue(tx(o.id, 'PAYK1', 'Completed'));
    const r = await svc.handleCallback('PAYK1', 'success');
    expect(r.outcome).not.toBe('success');
    expect(await orphans(o.id)).toEqual([{ reason: 'ORDER_NOT_PENDING' }]);
  }, 20000);

  it('F2 REAL (fixed): a "success" return that never completed is not reported as success', async () => {
    afterCutoff();
    const sid = await newSchool();
    const o = await pending(sid);
    const { svc, client } = bkashWorld();
    client.create.mockResolvedValueOnce(created('PAYE1'));
    await svc.startPayment(sid, o.id);
    client.query.mockResolvedValue(tx(o.id, 'PAYE1', 'Initiated'));
    client.execute.mockResolvedValue(tx(o.id, 'PAYE1', 'Initiated'));
    const r = await svc.handleCallback('PAYE1', 'success');
    expect(r.outcome).not.toBe('success');
    expect(await statusOf(o.id)).toBe(SeatOrderStatus.PENDING);
  }, 20000);

  it('F3 NOT REAL: a limit change invalidates the read-only cache; count only grows through seat-limit, which refuses past the limit', async () => {
    // The 300 s cache (tenant-status.service.ts) is cleared by recompute whenever the limit
    // changes. A student count cannot pass the limit through the API (billing.integration.spec
    // pins the refusal), so the cached "not read-only" cannot go wrong on a count change.
    afterCutoff();
    const sid = await newSchool();
    await entitlement.recomputeAndNotify(sid); // limit 0 after cutoff, no order
    tenantStatus.invalidate.mockClear();
    const o = await pending(sid, 5);
    await orders.markPaid(o.id, { method: PlatformPaymentMethod.OFFLINE_CASH });
    await entitlement.recomputeAndNotify(sid);
    expect((await ds.getRepository(School).findOneOrFail({ where: { id: sid } })).seat_limit).toBe(
      5,
    );
    expect(tenantStatus.invalidate).toHaveBeenCalledWith(sid);
  });

  it('F4 NOT REAL: offline payment fails closed when bKash state cannot be read, and never records anything', async () => {
    afterCutoff();
    const o = await pending(await newSchool());
    const { svc, redis } = bkashWorld();
    redis.exists.mockRejectedValue(new Error('redis down'));
    platform = new PlatformBillingService(ds, orders, audit, {} as never, svc);
    await expect(
      platform.recordOfflinePayment(
        o.id,
        {
          method: PlatformPaymentMethod.OFFLINE_CASH,
          reference: 'SLIP1',
          idempotency_key: 'idem-key-1',
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(await statusOf(o.id)).toBe(SeatOrderStatus.PENDING);
  });

  it('F5 NOT REAL: BillingModule wires everything the services above inject', () => {
    const providers: unknown[] = Reflect.getMetadata('providers', BillingModule);
    for (const p of [BkashService, PlatformBillingService, OrdersService, SeatNoticesService]) {
      expect(providers).toContain(p);
    }
    expect(Reflect.getMetadata('exports', BillingModule)).toEqual([
      EntitlementService,
      OrdersService,
    ]);
  });

  it('F6 NOT REAL: the seat notice counts only ACTIVE, not-deleted students and stamps once', async () => {
    process.env.BILLING_FREE_UNTIL = '2026-01-01T00:00:00+06:00';
    const sid = await newSchool();
    await ds.query(`UPDATE schools SET seat_limit = 20 WHERE id = $1`, [sid]);
    // Last paid day is 2026-12-01 + 7: the d7 notice is due.
    await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start, period_end, status, idempotency_key, paid_at)
       VALUES ($1, 20, 1, 1000, 5000, DATE '2026-10-08', DATE '2026-12-08', 'PAID', gen_random_uuid()::text, NOW())`,
      [sid],
    );
    await addStudent(sid);
    await ds.query(`UPDATE students SET deleted_at = now() WHERE tenant_id = $1`, [sid]);
    const notifyAdmins = vi.fn().mockResolvedValue(undefined);
    const svc = new SeatNoticesService(
      ds,
      { findAllActive: async () => [{ id: sid }] } as unknown as SchoolsService,
      { notifyAdmins } as unknown as AdminNoticeService,
    );
    const now = new Date('2026-12-01T06:00:00Z');
    await svc.runDaily(now);
    await svc.runDaily(now);
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    // The only student is deleted: not "over".
    expect(notifyAdmins.mock.calls[0][2]).toMatchObject({ over: false });
  });

  it('F7 NOT REAL: markPaid sets the receipt and the seat limit together; a replay changes nothing', async () => {
    afterCutoff();
    const sid = await newSchool();
    const o = await pending(sid, 4);
    const first = await orders.markPaid(o.id, { method: PlatformPaymentMethod.OFFLINE_CASH });
    const second = await orders.markPaid(o.id, { method: PlatformPaymentMethod.OFFLINE_CASH });
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    const [row] = await ds.query('SELECT receipt_number FROM seat_orders WHERE id = $1', [o.id]);
    expect(row.receipt_number).toBeTruthy();
    expect((await ds.getRepository(School).findOneOrFail({ where: { id: sid } })).seat_limit).toBe(
      4,
    );
    const n = await ds.query(
      'SELECT count(*)::int n FROM platform_payments WHERE seat_order_id = $1',
      [o.id],
    );
    expect(n[0].n).toBe(1);
  });

  describe('F8 / F9 REAL, outside billing (new issue): read-only mode refuses POST-shaped previews', () => {
    // Pinned as today's behaviour. When the fix lands (a read-shaped-POST allowance), flip these.
    const UNTIL = new Date('2027-01-07T18:00:00.000Z');
    const guard = new ContextGuard(new Reflector(), {
      isActive: async () => true,
      getStatus: async () => 'ACTIVE',
      getStatusReason: async () => null,
      isSuspendedForBilling: async () => false,
      isRestoring: async () => false,
      getReadOnlyUntil: async () => UNTIL,
    } as unknown as TenantStatusService);
    const post = (handler: (...a: never[]) => unknown) =>
      guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({
            method: 'POST',
            user: {
              sub: 'u1',
              email: 'a@b.c',
              phone: null,
              memberships: [{ tenantId: 't1', role: UserRole.ADMIN }],
            },
            headers: { 'x-tenant-id': 't1' },
          }),
        }),
        getHandler: () => handler,
        getClass: () => class {},
      } as never);

    it('F8: the fee-generation dry run ("writes nothing") gets 403 TENANT_READ_ONLY', async () => {
      await expect(post(FeeController.prototype.previewGenerateFees)).rejects.toMatchObject({
        status: 403,
      });
    });

    it('F9: the print preview gets 403 TENANT_READ_ONLY', async () => {
      await expect(post(PrintJobsController.prototype.preview)).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  it('F10 REAL (fixed): a cancelled bKash attempt does not block an offline payment for 24 h', async () => {
    afterCutoff();
    const sid = await newSchool();
    const o = await pending(sid);
    const { svc, client } = bkashWorld();
    client.create.mockResolvedValueOnce(created('PAYF1'));
    await svc.startPayment(sid, o.id);
    // While the checkout page is open the payment may still complete: offline is refused.
    expect(await svc.paymentMayBeLive(o.id)).toBe(true);
    // The admin cancels on bKash; bKash itself reports it Cancelled.
    client.query.mockResolvedValue(tx(o.id, 'PAYF1', 'Cancelled'));
    await svc.handleCallback('PAYF1', 'cancel');
    platform = new PlatformBillingService(ds, orders, audit, {} as never, svc);
    const [{ id: actor }] = await ds.query('SELECT id FROM users LIMIT 1');
    const r = await platform.recordOfflinePayment(
      o.id,
      {
        method: PlatformPaymentMethod.OFFLINE_CASH,
        reference: 'SLIP2',
        idempotency_key: 'idem-key-2',
      },
      actor,
    );
    expect(r.applied).toBe(true);
  }, 20000);
});
