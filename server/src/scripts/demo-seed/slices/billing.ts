import { PlatformPaymentMethod, SeatOrderStatus } from '@biddaloy/shared';
import { SeatOrder } from '../../../modules/billing/entities/seat-order.entity';
import { PlatformPayment } from '../../../modules/billing/entities/platform-payment.entity';
import type { DemoSlice } from '../context';
import { orgIds } from './org';

/** Seats per branch at scale 1; the one paid order covers the anchor (-6m .. +6m). */
const SEATS = 1400;
const MONTHS = 12;
/** Paisa per seat per month (BDT 10, the Epic 49 list price). */
const UNIT_PRICE_PAISA = 1000;

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
  covers: [SeatOrder, PlatformPayment],
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
    return tenants.length * 2;
  },
};
