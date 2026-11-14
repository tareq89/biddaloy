import {
  CouponDiscountKind,
  CouponScope,
  PlatformPaymentMethod,
  SeatOrderStatus,
} from '@biddaloy/shared';
import { DEFAULT_PLAN_ID, Plan } from '../../../modules/plans/entities/plan.entity';
import { Coupon } from '../../../modules/coupons/entities/coupon.entity';
import { CouponSchool } from '../../../modules/coupons/entities/coupon-school.entity';
import { CouponRedemption } from '../../../modules/coupons/entities/coupon-redemption.entity';
import { SeatOrder } from '../../../modules/billing/entities/seat-order.entity';
import { PlatformPayment } from '../../../modules/billing/entities/platform-payment.entity';
import type { DemoSlice } from '../context';
import { orgIds } from './org';

/** Seats per branch at scale 1; the one paid order covers the anchor (-6m .. +6m). */
const SEATS = 1400;
const MONTHS = 12;
/** Paisa per seat per month (BDT 10, the Epic 49 list price). */
const UNIT_PRICE_PAISA = 1000;
/** [Epic 100] The second plan (paisa per seat per month) and the demo coupon (50% off, 3 months at most). */
const PLUS_PRICE_PAISA = 1500;
const COUPON_CODE = 'DEMO-HALF';
const SMALL_ORDER_MONTHS = 3;

/**
 * [49/#2184] One PAID seat order plus its offline-bank payment per branch, so Settings >
 * Seats & billing and the platform ledger are never empty in the demo.
 *
 * Deliberately NOT touched: `schools.seat_limit` stays NULL (unlimited) and `trial_ends_at`
 * stays NULL. The demo skips the EntitlementService recompute; a seeded limit would cap the
 * demo's own bulk student loads. `free_until` is env-derived, not stored, so there is no
 * free-period row to seed.
 */
export const slice: DemoSlice = {
  name: 'billing',
  covers: [SeatOrder, PlatformPayment, Plan, Coupon, CouponSchool, CouponRedemption],
  async run(ctx) {
    const { tenants, adminUserId } = orgIds(ctx);
    const seats = Math.max(1, ctx.count(SEATS));
    const amount = String(seats * MONTHS * UNIT_PRICE_PAISA);
    // Postgres does the month maths: it clamps 31 Oct - 6 months to a real day.
    const [{ start, end }] = await ctx.ds.query(
      `SELECT ($1::date - interval '6 months')::date::text AS start,
              ($1::date + interval '6 months')::date::text AS "end"`,
      [ctx.anchor],
    );

    // Receipt numbers follow the real series (`SMR-<year of payment>-NNNNNN`).
    const year = start.slice(0, 4);
    for (const [i, t] of tenants.entries()) {
      const [school]: { name: string; address: string | null }[] = await ctx.ds.query(
        'SELECT name, address FROM schools WHERE id = $1',
        [t.id],
      );
      const order = await ctx.ds.getRepository(SeatOrder).save({
        school_id: t.id,
        seats,
        months: MONTHS,
        unit_price_paisa: UNIT_PRICE_PAISA,
        amount_paisa: amount,
        period_start: start,
        period_end: end,
        status: SeatOrderStatus.PAID,
        receipt_number: `SMR-${year}-${String(i + 1).padStart(6, '0')}`,
        receipt_snapshot: { name: school.name, address: school.address, vat: null },
        idempotency_key: `demo-${t.slug}-1`,
        created_by_user_id: adminUserId,
        paid_at: new Date(`${start}T00:00:00+06:00`),
      });
      await ctx.ds.getRepository(PlatformPayment).save({
        seat_order_id: order.id,
        method: PlatformPaymentMethod.OFFLINE_BANK,
        amount_paisa: amount,
        recorded_by_user_id: adminUserId,
      });
    }

    // [Epic 100/#3875] Platform money data, all on the two quarters BEFORE the big order's period so no
    // school has two PAID orders for the same day. Dates come from Postgres off the anchor.
    const [d]: { from: string; to: string; ends: string }[] = await ctx.ds.query(
      `SELECT ($1::date - interval '9 months')::date::text AS "from",
              ($1::date - interval '6 months' - interval '1 day')::date::text AS "to",
              ($1::date + interval '1 year')::date::text AS ends`,
      [ctx.anchor],
    );
    const plus = await ctx.ds.getRepository(Plan).save({
      name: 'Plus',
      unit_price_paisa: PLUS_PRICE_PAISA,
      active: true,
      is_default: false,
    });
    const couponSchool = tenants[0];
    const refundSchool = tenants[1] ?? tenants[0];
    await ctx.ds.query('UPDATE schools SET plan_id = $2 WHERE id = $1', [refundSchool.id, plus.id]);
    const coupon = await ctx.ds.getRepository(Coupon).save({
      code: COUPON_CODE,
      discount_kind: CouponDiscountKind.PERCENT,
      percent: 50,
      max_months: SMALL_ORDER_MONTHS,
      scope: CouponScope.SCHOOLS,
      max_uses: 100,
      uses_count: 1,
      starts_at: new Date(`${start}T00:00:00+06:00`),
      ends_at: new Date(`${d.ends}T00:00:00+06:00`),
      created_by_user_id: adminUserId,
    });
    await ctx.ds
      .getRepository(CouponSchool)
      .save({ coupon_id: coupon.id, school_id: couponSchool.id });

    const small = Math.max(1, ctx.count(200));
    const listPaisa = small * SMALL_ORDER_MONTHS * UNIT_PRICE_PAISA;
    const discount = listPaisa / 2;
    const extra = async (
      t: { id: string; slug: string },
      n: number,
      o: { unit: number; planId: string | null; discount: number; status: SeatOrderStatus },
    ) => {
      const [school]: { name: string; address: string | null }[] = await ctx.ds.query(
        'SELECT name, address FROM schools WHERE id = $1',
        [t.id],
      );
      const amount = String(small * SMALL_ORDER_MONTHS * o.unit - o.discount);
      const paidAt = new Date(`${d.from}T00:00:00+06:00`);
      const order = await ctx.ds.getRepository(SeatOrder).save({
        school_id: t.id,
        seats: small,
        months: SMALL_ORDER_MONTHS,
        unit_price_paisa: o.unit,
        amount_paisa: amount,
        period_start: d.from,
        period_end: d.to,
        status: o.status,
        receipt_number: `SMR-${year}-${String(100 + n).padStart(6, '0')}`,
        receipt_snapshot: { name: school.name, address: school.address, vat: null },
        idempotency_key: `demo-${t.slug}-extra-${n}`,
        created_by_user_id: adminUserId,
        paid_at: paidAt,
        plan_id: o.planId,
        coupon_id: o.discount > 0 ? coupon.id : null,
        discount_paisa: String(o.discount),
        ...(o.status === SeatOrderStatus.REFUNDED
          ? {
              refunded_at: new Date(`${ctx.anchor}T00:00:00+06:00`),
              refund_reason: 'Paid twice by mistake',
              refunded_by_user_id: adminUserId,
            }
          : {}),
      });
      await ctx.ds.getRepository(PlatformPayment).save({
        seat_order_id: order.id,
        method: PlatformPaymentMethod.OFFLINE_BANK,
        amount_paisa: amount,
        recorded_by_user_id: adminUserId,
      });
      return order;
    };
    const couponOrder = await extra(couponSchool, 1, {
      unit: UNIT_PRICE_PAISA,
      planId: DEFAULT_PLAN_ID,
      discount,
      status: SeatOrderStatus.PAID,
    });
    await ctx.ds.getRepository(CouponRedemption).save({
      coupon_id: coupon.id,
      school_id: couponSchool.id,
      seat_order_id: couponOrder.id,
      discount_paisa: String(discount),
    });
    await extra(refundSchool, 2, {
      unit: PLUS_PRICE_PAISA,
      planId: plus.id,
      discount: 0,
      status: SeatOrderStatus.REFUNDED,
    });

    return tenants.length * 2 + 8;
  },
};
