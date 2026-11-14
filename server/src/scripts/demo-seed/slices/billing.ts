import {
  CouponDiscountKind,
  CouponScope,
  PlatformPaymentMethod,
  SeatOrderStatus,
} from '@biddaloy/shared';
import { Coupon } from '../../../modules/coupons/entities/coupon.entity';
import { CouponRedemption } from '../../../modules/coupons/entities/coupon-redemption.entity';
import { CouponSchool } from '../../../modules/coupons/entities/coupon-school.entity';
import { DEFAULT_PLAN_ID, Plan } from '../../../modules/plans/entities/plan.entity';
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
  // `plans` already holds the migration's default 'Standard' row; each order points at it.
  covers: [SeatOrder, PlatformPayment, Plan, Coupon, CouponSchool, CouponRedemption],
  async run(ctx) {
    const { tenants, adminUserId } = orgIds(ctx);
    const seats = Math.max(1, ctx.count(SEATS));
    const amount = String(seats * MONTHS * UNIT_PRICE_PAISA);
    // Postgres does the month maths: it clamps 31 Oct - 6 months to a real day.
    const [{ start, end, couponEnd, from, to }] = await ctx.ds.query(
      `SELECT ($1::date - interval '6 months')::date::text AS start,
              ($1::date - interval '9 months')::date::text AS "from",
              ($1::date - interval '6 months' - interval '1 day')::date::text AS "to",
              ($1::date + interval '6 months')::date::text AS "end",
              ($1::date + interval '12 months')::date::text AS "couponEnd"`,
      [ctx.anchor],
    );

    // [Epic 100] A 10 percent welcome coupon for every school (the first branch used it), and a
    // 50 percent one (3 months at most) for a chosen branch only. Dates hang off the anchor;
    // `start` is when the paid order began.
    const [welcome, branchOnly] = await ctx.ds.getRepository(Coupon).save(
      [
        { code: 'DEMOWELCOME', scope: CouponScope.ALL, uses_count: 1, percent: 10 },
        {
          code: COUPON_CODE,
          scope: CouponScope.SCHOOLS,
          uses_count: 1,
          percent: 50,
          max_months: SMALL_ORDER_MONTHS,
        },
      ].map((c) => ({
        ...c,
        discount_kind: CouponDiscountKind.PERCENT,
        max_uses: 100,
        starts_at: new Date(`${start}T00:00:00+06:00`),
        ends_at: new Date(`${couponEnd}T00:00:00+06:00`),
        created_by_user_id: adminUserId,
      })),
    );
    await ctx.ds
      .getRepository(CouponSchool)
      .save({ coupon_id: branchOnly.id, school_id: tenants[0].id });
    // 10 percent of a whole-paisa multiple of 1000 is whole paisa (Rule 26).
    const discount = String(BigInt(amount) / 10n);
    const net = String(BigInt(amount) - BigInt(discount));

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
        amount_paisa: i === 0 ? net : amount,
        plan_id: DEFAULT_PLAN_ID,
        coupon_id: i === 0 ? welcome.id : null,
        discount_paisa: i === 0 ? discount : '0',
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
        amount_paisa: i === 0 ? net : amount,
        recorded_by_user_id: adminUserId,
      });
      if (i === 0) {
        await ctx.ds.getRepository(CouponRedemption).save({
          coupon_id: welcome.id,
          school_id: t.id,
          seat_order_id: order.id,
          discount_paisa: discount,
        });
      }
    }

    // [Epic 100] Two small orders in the quarter BEFORE the big one (no school gets two PAID orders
    // for the same day): a paid one with the 50 percent coupon, and a REFUNDED one on the Plus plan.
    const plus = await ctx.ds.getRepository(Plan).save({
      name: 'Plus',
      unit_price_paisa: PLUS_PRICE_PAISA,
      active: true,
      is_default: false,
    });
    const couponSchool = tenants[0];
    const refundSchool = tenants[1] ?? tenants[0];
    await ctx.ds.query('UPDATE schools SET plan_id = $2 WHERE id = $1', [refundSchool.id, plus.id]);
    const small = Math.max(1, ctx.count(200));
    const extra = async (
      t: { id: string; slug: string },
      n: number,
      o: { unit: number; planId: string; discount: number; status: SeatOrderStatus },
    ) => {
      const [school]: { name: string; address: string | null }[] = await ctx.ds.query(
        'SELECT name, address FROM schools WHERE id = $1',
        [t.id],
      );
      const paid = String(small * SMALL_ORDER_MONTHS * o.unit - o.discount);
      const order = await ctx.ds.getRepository(SeatOrder).save({
        school_id: t.id,
        seats: small,
        months: SMALL_ORDER_MONTHS,
        unit_price_paisa: o.unit,
        amount_paisa: paid,
        period_start: from,
        period_end: to,
        status: o.status,
        receipt_number: `SMR-${year}-${String(100 + n).padStart(6, '0')}`,
        receipt_snapshot: { name: school.name, address: school.address, vat: null },
        idempotency_key: `demo-${t.slug}-extra-${n}`,
        created_by_user_id: adminUserId,
        paid_at: new Date(`${from}T00:00:00+06:00`),
        plan_id: o.planId,
        coupon_id: o.discount > 0 ? branchOnly.id : null,
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
        amount_paisa: paid,
        recorded_by_user_id: adminUserId,
      });
      return order;
    };
    // 50 percent of a whole-paisa multiple of 1000 is whole paisa (Rule 26).
    const half = (small * SMALL_ORDER_MONTHS * UNIT_PRICE_PAISA) / 2;
    const couponOrder = await extra(couponSchool, 1, {
      unit: UNIT_PRICE_PAISA,
      planId: DEFAULT_PLAN_ID,
      discount: half,
      status: SeatOrderStatus.PAID,
    });
    await ctx.ds.getRepository(CouponRedemption).save({
      coupon_id: branchOnly.id,
      school_id: couponSchool.id,
      seat_order_id: couponOrder.id,
      discount_paisa: String(half),
    });
    await extra(refundSchool, 2, {
      unit: PLUS_PRICE_PAISA,
      planId: plus.id,
      discount: 0,
      status: SeatOrderStatus.REFUNDED,
    });
    return tenants.length * 2 + 8; // + 2 coupons, 1 coupon school, 1 plan, 2 orders+payments, 1 redemption
  },
};
