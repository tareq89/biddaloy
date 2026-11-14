import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PlatformPaymentMethod, SeatOrderStatus } from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../audit/audit.service';
import { School } from '../schools/entities/school.entity';
import { TenantStatusService } from '../schools/tenant-status.service';
import { StudentService, GuardianService } from '../students/students.service';
import { SessionCutoffService } from '../auth/session-cutoff.service';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { EntitlementService } from './entitlement.service';
import { OrdersService } from './orders.service';
import { ordersTestDeps } from './orders-test-deps';
import { ReceiptService } from './receipt.service';

// Needs Postgres: the order, the redemption and the payment must agree in one transaction.
describe('OrdersService plan + coupon (integration)', () => {
  let ds: DataSource;
  let orders: OrdersService;
  const tag = randomUUID().slice(0, 8);
  const moneyNotices = { couponApplied: vi.fn().mockResolvedValue(undefined) };
  const receipts = { emailReceipt: vi.fn() };
  const originalFreeUntil = process.env.BILLING_FREE_UNTIL;
  const schoolIds: string[] = [];
  const planIds: string[] = [];
  const couponIds: string[] = [];

  beforeAll(async () => {
    process.env.BILLING_FREE_UNTIL = '2000-01-01T00:00:00+06:00';
    const module = await createTestModule(ALL_ENTITIES, [
      EntitlementService,
      OrdersService,
      StudentService,
      GuardianService,
      AuditService,
      ...ordersTestDeps({ moneyNotices }),
      {
        provide: TenantStatusService,
        useValue: { invalidate: vi.fn().mockResolvedValue(undefined) },
      },
      { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
      { provide: AdminNoticeService, useValue: { notifyAdmins: vi.fn() } },
      { provide: ReceiptService, useValue: receipts },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    orders = module.get(OrdersService);
  }, 60000);

  afterEach(async () => {
    moneyNotices.couponApplied.mockClear();
    receipts.emailReceipt.mockClear();
  });

  afterAll(async () => {
    if (originalFreeUntil === undefined) delete process.env.BILLING_FREE_UNTIL;
    else process.env.BILLING_FREE_UNTIL = originalFreeUntil;
    if (!ds) return;
    for (const id of schoolIds) {
      await ds.query(
        'DELETE FROM platform_payments WHERE seat_order_id IN (SELECT id FROM seat_orders WHERE school_id = $1)',
        [id],
      );
      await ds.query('DELETE FROM coupon_redemptions WHERE school_id = $1', [id]);
      await ds.query('DELETE FROM seat_orders WHERE school_id = $1', [id]);
      await ds.query('DELETE FROM schools WHERE id = $1', [id]);
    }
    for (const id of couponIds) await ds.query('DELETE FROM coupons WHERE id = $1', [id]);
    for (const id of planIds) await ds.query('DELETE FROM plans WHERE id = $1', [id]);
    await ds.destroy();
  });

  /** A school on its own plan, so a price change here touches nobody else. */
  const newSchool = async (unitPaisa = 1200): Promise<{ id: string; planId: string }> => {
    const planId = randomUUID();
    await ds.query(`INSERT INTO plans (id, name, unit_price_paisa) VALUES ($1, $2, $3)`, [
      planId,
      `Plan ${tag} ${planId.slice(0, 6)}`,
      unitPaisa,
    ]);
    planIds.push(planId);
    const id = randomUUID();
    await ds.getRepository(School).save({
      id,
      tenant_id: id,
      name: `Coupon ${id.slice(0, 6)}`,
      slug: `oc-${id.slice(0, 8)}`,
    });
    await ds.query('UPDATE schools SET plan_id = $2 WHERE id = $1', [id, planId]);
    schoolIds.push(id);
    return { id, planId };
  };

  /** FIXED coupon (per month), or PERCENT 100: the only kind the engine lets price an order at 0. */
  const newCoupon = async (fixedPaisa: number | 'FREE'): Promise<string> => {
    const code = `OC-${tag}-${randomUUID().slice(0, 6)}`.toUpperCase();
    const id = randomUUID();
    const free = fixedPaisa === 'FREE';
    await ds.query(
      `INSERT INTO coupons (id, code, discount_kind, fixed_paisa, percent, scope, per_school_max, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, 'ALL', 5, now() - interval '1 day', now() + interval '1 day')`,
      [id, code, free ? 'PERCENT' : 'FIXED', free ? null : fixedPaisa, free ? 100 : null],
    );
    couponIds.push(id);
    return code;
  };

  const usesOf = async (code: string): Promise<number> =>
    (await ds.query('SELECT uses_count FROM coupons WHERE code = $1', [code]))[0].uses_count;

  const base = (schoolId: string, extra: object = {}) => ({
    schoolId,
    seats: 10,
    months: 3,
    idempotency_key: randomUUID(),
    userId: null,
    ...extra,
  });

  it('prices from the school plan, not a constant', async () => {
    const s = await newSchool(1200);
    const o = await orders.createPending(base(s.id));
    expect(o.unit_price_paisa).toBe(1200);
    expect(o.amount_paisa).toBe(10 * 3 * 1200);
    expect(o.discount_paisa).toBe(0);
    const [row] = await ds.query('SELECT plan_id FROM seat_orders WHERE id = $1', [o.id]);
    expect(row.plan_id).toBe(s.planId);
  });

  it('a coupon order is priced, stamped and uses one use', async () => {
    const s = await newSchool(1000);
    const code = await newCoupon(500);
    const o = await orders.createPending(base(s.id, { coupon_code: code.toLowerCase() }));
    expect(o).toMatchObject({
      status: SeatOrderStatus.PENDING,
      amount_paisa: 30000 - 1500,
      discount_paisa: 1500,
      coupon_code: code,
    });
    expect(await usesOf(code)).toBe(1);
    expect(moneyNotices.couponApplied).toHaveBeenCalledWith(o.id);
  });

  it('a replay redeems once; a replay with another coupon or none is 409', async () => {
    const s = await newSchool(1000);
    const code = await newCoupon(500);
    const input = base(s.id, { coupon_code: code });
    const first = await orders.createPending(input);
    const again = await orders.createPending({ ...input, coupon_code: code.toLowerCase() });
    expect(again.id).toBe(first.id);
    expect(await usesOf(code)).toBe(1);
    expect(moneyNotices.couponApplied).toHaveBeenCalledTimes(1);
    await expect(orders.createPending({ ...input, coupon_code: undefined })).rejects.toMatchObject({
      response: { details: { code: 'IDEMPOTENCY_KEY_REUSED' } },
    });
    const other = await newCoupon(100);
    await expect(orders.createPending({ ...input, coupon_code: other })).rejects.toMatchObject({
      response: { details: { code: 'IDEMPOTENCY_KEY_REUSED' } },
    });
  });

  it('a wrong code is the one coupon sentence and leaves no order row', async () => {
    const s = await newSchool();
    const input = base(s.id, { coupon_code: 'NOPE-0000' });
    await expect(orders.createPending(input)).rejects.toMatchObject({
      response: { details: { code: 'COUPON_NOT_VALID' } },
    });
    const rows = await ds.query('SELECT 1 FROM seat_orders WHERE school_id = $1', [s.id]);
    expect(rows).toHaveLength(0);
  });

  it('a 100 percent coupon is PAID at once: receipt, COUPON payment, entitlement, one transaction', async () => {
    const s = await newSchool(1000);
    const code = await newCoupon('FREE');
    const o = await orders.createPending(base(s.id, { coupon_code: code }));
    expect(o).toMatchObject({
      status: SeatOrderStatus.PAID,
      amount_paisa: 0,
      discount_paisa: 30000,
    });
    expect(o.receipt_number).toMatch(/^SMR-\d{4}-\d{6}$/);
    expect(o.method).toBe(PlatformPaymentMethod.COUPON);
    const [row] = await ds.query('SELECT receipt_snapshot FROM seat_orders WHERE id = $1', [o.id]);
    expect(row.receipt_snapshot).toMatchObject({ coupon_code: code, discount_paisa: 30000 });
    const [school] = await ds.query('SELECT seat_limit FROM schools WHERE id = $1', [s.id]);
    expect(school.seat_limit).toBe(10);
    expect(receipts.emailReceipt).toHaveBeenCalledWith(o.id);
    expect(moneyNotices.couponApplied).toHaveBeenCalledWith(o.id);
    expect(await usesOf(code)).toBe(1);
  });

  it('paying a partly discounted order by bKash charges the discounted amount', async () => {
    const s = await newSchool(1000);
    const code = await newCoupon(500);
    const o = await orders.createPending(base(s.id, { coupon_code: code }));
    expect((await orders.findForPayment(o.id))?.amount_paisa).toBe('28500');
    await orders.markPaid(o.id, { method: PlatformPaymentMethod.BKASH, gateway_ref: 'trx' });
    const [p] = await ds.query(
      'SELECT amount_paisa FROM platform_payments WHERE seat_order_id = $1',
      [o.id],
    );
    expect(p.amount_paisa).toBe('28500');
  });

  it('a plan price change affects only the next order', async () => {
    const s = await newSchool(1200);
    const first = await orders.createPending(base(s.id));
    await ds.query('UPDATE plans SET unit_price_paisa = 1500 WHERE id = $1', [s.planId]);
    const second = await orders.createPending(base(s.id));
    const [old] = await ds.query('SELECT unit_price_paisa FROM seat_orders WHERE id = $1', [
      first.id,
    ]);
    expect(old.unit_price_paisa).toBe(1200);
    expect(second.unit_price_paisa).toBe(1500);
  });

  it('preview prices without writing or using the coupon', async () => {
    const s = await newSchool(1000);
    const code = await newCoupon(500);
    const p = await orders.preview(s.id, { seats: 10, months: 3, coupon_code: code });
    expect(p).toMatchObject({
      listAmountPaisa: 30000,
      discountPaisa: 1500,
      totalPaisa: 28500,
      free: false,
      unit_price_paisa: 1000,
    });
    expect(await usesOf(code)).toBe(0);
    expect(await ds.query('SELECT 1 FROM seat_orders WHERE school_id = $1', [s.id])).toHaveLength(
      0,
    );
  });

  it('a GRANT keeps its price 0 and never takes a coupon', async () => {
    const s = await newSchool(1000);
    const code = await newCoupon(500);
    const o = await orders.createPending(base(s.id, { unit_price_paisa: 0, coupon_code: code }));
    expect(o).toMatchObject({ unit_price_paisa: 0, amount_paisa: 0, discount_paisa: 0 });
    expect(await usesOf(code)).toBe(0);
  });
});
