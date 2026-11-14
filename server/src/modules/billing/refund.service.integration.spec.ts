import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { makeMeteredCreditService } from '@test/helpers/sms-credit-ledger.helper';
import { AuditService } from '../audit/audit.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { SmsCreditService } from '../communications/credits/sms-credit.service';
import { checkLotInvariants } from '../communications/credits/sms-credit-lot-invariants';
import { TenantStatusService } from '../schools/tenant-status.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { EntitlementService } from './entitlement.service';
import { RefundService, REFUND_NOTE } from './refund.service';

/** [100.3.06] Refunds against the real schema. Billing applies (free period long over). */
describe('RefundService (integration)', () => {
  let ds: DataSource;
  let entitlement: EntitlementService;
  let credits: SmsCreditService;
  let svc: RefundService;
  const refundDone = vi.fn().mockResolvedValue(undefined);
  const original = process.env.BILLING_FREE_UNTIL;

  beforeAll(async () => {
    process.env.BILLING_FREE_UNTIL = '2000-01-01T00:00:00+06:00';
    const module = await createTestModule(ALL_ENTITIES, [
      EntitlementService,
      AuditService,
      SessionCutoffService,
      {
        provide: TenantStatusService,
        useValue: { invalidate: vi.fn(), platformSchoolIds: vi.fn().mockResolvedValue([]) },
      },
      { provide: AdminNoticeService, useValue: { notifyAdmins: vi.fn() } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    entitlement = module.get(EntitlementService);
    credits = makeMeteredCreditService(ds);
    svc = new RefundService(ds, entitlement, credits, module.get(AuditService), {
      refundDone,
    } as never);
  }, 60000);

  afterAll(async () => {
    if (original === undefined) delete process.env.BILLING_FREE_UNTIL;
    else process.env.BILLING_FREE_UNTIL = original;
    if (ds) await ds.destroy();
  });

  const actor = async (): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, 'x', 'Refunder', 'ACTIVE', NOW(), NOW())`,
      [id, `${id}@refund.example`],
    );
    return id;
  };
  const school = async (): Promise<string> => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO schools (id, name, slug, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW())`,
      [id, `Refund ${id.slice(0, 6)}`, `refund-${id.slice(0, 8)}`],
    );
    return id;
  };
  const seatOrder = async (schoolId: string, o: { price?: number; couponId?: string } = {}) =>
    (
      await ds.query(
        `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start,
                                  period_end, status, idempotency_key, coupon_id)
         VALUES ($1, 25, 1, $2, $3, CURRENT_DATE - 1, CURRENT_DATE + 30, 'PAID', $4, $5) RETURNING id`,
        [schoolId, o.price ?? 1000, (o.price ?? 1000) * 25, randomUUID(), o.couponId ?? null],
      )
    )[0].id as string;
  const limit = async (schoolId: string) =>
    (await ds.query('SELECT seat_limit FROM schools WHERE id = $1', [schoolId]))[0].seat_limit as
      number | null;

  /** An ACTIVE package order with its lot, made through the real purchase path. */
  const bundle = async (schoolId: string, units = 100) => {
    const [{ id: catalog }] = await ds.query(
      `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active)
       VALUES ($1, $2, 30, 10000, true) RETURNING id`,
      [`Pkg ${randomUUID()}`, units],
    );
    const [{ id }] = await ds.query(
      `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days,
                                      price_paisa, status, idempotency_key)
       VALUES ($1, $2, 'Pkg', $3, 30, 10000, 'ACTIVE', $4) RETURNING id`,
      [schoolId, catalog, units, randomUUID()],
    );
    await credits.purchase(schoolId, {
      bundleOrderId: id,
      units,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
      idempotencyKey: `purchase:${id}`,
    });
    return id as string;
  };
  const balance = async (schoolId: string) =>
    (
      await ds.query('SELECT available, reserved FROM sms_credit_balance WHERE tenant_id = $1', [
        schoolId,
      ])
    )[0] as { available: number; reserved: number };
  const ledgerSum = async (schoolId: string) =>
    Number(
      (
        await ds.query(
          `SELECT COALESCE(SUM(CASE WHEN kind IN ('GRANT','PURCHASE','ADJUST') THEN units END), 0) AS n
             FROM sms_credit_ledger WHERE tenant_id = $1`,
          [schoolId],
        )
      )[0].n,
    );

  it('refunding a PAID seat order drops the entitlement; a second call changes nothing', async () => {
    const s = await school();
    const by = await actor();
    const id = await seatOrder(s);
    await entitlement.recomputeAndNotify(s);
    expect(await limit(s)).toBe(25);

    const first = await svc.refundSeatOrder(id, 'Paid twice by mistake', by, 'a1');
    expect(first).toMatchObject({ applied: true, order_id: id, note: REFUND_NOTE });
    expect(await limit(s)).toBe(0);
    const [row] = await ds.query(
      'SELECT status, refunded_at, refund_reason, refunded_by_user_id FROM seat_orders WHERE id = $1',
      [id],
    );
    expect(row).toMatchObject({
      status: 'REFUNDED',
      refund_reason: 'Paid twice by mistake',
      refunded_by_user_id: by,
    });
    const audits = await ds.query(
      `SELECT new_values FROM audit_logs WHERE action = 'ORDER_REFUNDED' AND tenant_id = $1`,
      [s],
    );
    expect(audits).toHaveLength(1);

    refundDone.mockClear();
    const again = await svc.refundSeatOrder(id, 'Paid twice by mistake', by, 'a1');
    expect(again.applied).toBe(false);
    expect(refundDone).not.toHaveBeenCalled();
    const [row2] = await ds.query('SELECT refunded_at FROM seat_orders WHERE id = $1', [id]);
    expect(row2.refunded_at).toEqual(row.refunded_at);
  });

  it('a bKash payment ref is returned; the coupon use is not given back', async () => {
    const s = await school();
    const by = await actor();
    const couponId = randomUUID();
    await ds.query(
      `INSERT INTO coupons (id, code, discount_kind, fixed_paisa, scope, per_school_max, starts_at, ends_at, uses_count)
       VALUES ($1, $2, 'FIXED', 100, 'ALL', 5, now() - interval '1 day', now() + interval '1 day', 3)`,
      [couponId, `K7${randomUUID().slice(0, 6).toUpperCase()}`],
    );
    const id = await seatOrder(s, { couponId });
    await ds.query(
      `INSERT INTO platform_payments (seat_order_id, method, gateway_ref, amount_paisa)
       VALUES ($1, 'BKASH', 'TRX123', 25000)`,
      [id],
    );
    const res = await svc.refundSeatOrder(id, 'Customer asked back', by, 'a1');
    expect(res.gateway_ref).toBe('TRX123');
    const [c] = await ds.query('SELECT uses_count FROM coupons WHERE id = $1', [couponId]);
    expect(Number(c.uses_count)).toBe(3);
  });

  it('PENDING and GRANT seat orders are 409 ORDER_NOT_REFUNDABLE', async () => {
    const s = await school();
    const by = await actor();
    const grant = await seatOrder(s, { price: 0 });
    await expect(svc.refundSeatOrder(grant, 'Not a sale', by, 'a1')).rejects.toMatchObject({
      response: { details: { code: 'ORDER_NOT_REFUNDABLE' } },
    });
    const [{ id: pending }] = await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, period_start,
                                period_end, status, idempotency_key)
       VALUES ($1, 5, 1, 1000, 5000, CURRENT_DATE, CURRENT_DATE + 30, 'PENDING', $2) RETURNING id`,
      [s, randomUUID()],
    );
    await expect(svc.refundSeatOrder(pending, 'Not paid yet', by, 'a1')).rejects.toMatchObject({
      response: { details: { code: 'ORDER_NOT_REFUNDABLE' } },
    });
  });

  it('a fully discounted PAID seat order (amount 0) is 409 ORDER_NOT_REFUNDABLE', async () => {
    const s = await school();
    const by = await actor();
    const [{ id }] = await ds.query(
      `INSERT INTO seat_orders (school_id, seats, months, unit_price_paisa, amount_paisa, discount_paisa,
                                period_start, period_end, status, idempotency_key)
       VALUES ($1, 25, 1, 1000, 0, 25000, CURRENT_DATE - 1, CURRENT_DATE + 30, 'PAID', $2) RETURNING id`,
      [s, randomUUID()],
    );
    await expect(svc.refundSeatOrder(id, 'Free order', by, 'a1')).rejects.toMatchObject({
      response: { details: { code: 'ORDER_NOT_REFUNDABLE' } },
    });
  });

  it('an untouched package refunds: lot closed, balance back, ledger sum = balance', async () => {
    const s = await school();
    const by = await actor();
    const id = await bundle(s, 100);
    expect(await balance(s)).toMatchObject({ available: 100 });

    const res = await svc.refundBundleOrder(id, 'Bought the wrong one', by, 'a1');
    expect(res).toMatchObject({ applied: true, order_id: id, note: REFUND_NOTE });
    expect(await balance(s)).toMatchObject({ available: 0, reserved: 0 });
    expect(await ledgerSum(s)).toBe(0);
    const [lot] = await ds.query(
      'SELECT status, remaining, expired_units FROM sms_credit_lots WHERE bundle_order_id = $1',
      [id],
    );
    expect(lot).toMatchObject({ status: 'REFUNDED', remaining: 0, expired_units: 100 });
    const [o] = await ds.query(
      'SELECT status, refund_reason FROM sms_bundle_orders WHERE id = $1',
      [id],
    );
    expect(o).toMatchObject({ status: 'REFUNDED', refund_reason: 'Bought the wrong one' });
    const inv = await checkLotInvariants(ds, { tenantId: s });
    expect(inv.every((r) => r.lotsBroken.length === 0)).toBe(true);
    expect(inv[0]).toMatchObject({ available: 0, lotsRemaining: 0 });

    expect((await svc.refundBundleOrder(id, 'Bought the wrong one', by, 'a1')).applied).toBe(false);
    expect(await balance(s)).toMatchObject({ available: 0 });
  });

  it('after one reserve the package cannot be refunded; nothing moves', async () => {
    const s = await school();
    const by = await actor();
    const id = await bundle(s, 100);
    expect(await credits.reserve(s, 1, `r-${id}`)).toEqual({ ok: true });
    await expect(svc.refundBundleOrder(id, 'Too late for this', by, 'a1')).rejects.toMatchObject({
      response: { details: { code: 'BUNDLE_ALREADY_USED' } },
    });
    expect(await balance(s)).toMatchObject({ available: 99, reserved: 1 });
    const [o] = await ds.query('SELECT status FROM sms_bundle_orders WHERE id = $1', [id]);
    expect(o.status).toBe('ACTIVE');
  });

  /** Waits (a DB query per turn, no timers) until `n` backends wait on a lock. */
  const untilBlocked = async (n: number) => {
    for (let i = 0; i < 2000; i++) {
      const [{ c }] = await ds.query(
        `SELECT count(*)::int AS c FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (c >= n) return;
    }
    throw new Error('lock waiter never appeared');
  };

  it('latch: a reserve queued behind the refund sees the closed lot and gets nothing', async () => {
    const s = await school();
    const by = await actor();
    const id = await bundle(s, 100);
    let reserve!: Promise<unknown>;
    // The refund holds the balance row lock; the reserve starts inside it and must wait.
    await ds.transaction(async (m) => {
      await credits.closeUntouchedLot(m, s, id);
      reserve = credits.reserve(s, 1, `late-${id}`);
      await untilBlocked(1);
    });
    expect(await reserve).toEqual({ ok: false, available: 0 });
    expect(await balance(s)).toMatchObject({ available: 0, reserved: 0 });
    void by;
  });

  it('latch: a refund queued behind a held balance lock re-checks and refuses a used package', async () => {
    const s = await school();
    const by = await actor();
    const id = await bundle(s, 100);
    let refund!: Promise<unknown>;
    const outcome = ds.transaction(async (m) => {
      await m.query('SELECT 1 FROM sms_credit_balance WHERE tenant_id = $1 FOR UPDATE', [s]);
      refund = svc.refundBundleOrder(id, 'Racing the sender', by, 'a1').catch((e: unknown) => e);
      await untilBlocked(1);
      // What a winning reserve leaves behind, written while the refund waits on the lock.
      await m.query(
        `UPDATE sms_credit_lots SET remaining = remaining - 1, reserved_units = 1 WHERE bundle_order_id = $1`,
        [id],
      );
    });
    await outcome;
    expect(await refund).toMatchObject({ response: { details: { code: 'BUNDLE_ALREADY_USED' } } });
    const [o] = await ds.query('SELECT status FROM sms_bundle_orders WHERE id = $1', [id]);
    expect(o.status).toBe('ACTIVE');
  });
});
