import { PlatformPaymentMethod, SmsBundleOrderStatus, SmsLotSource } from '@biddaloy/shared';
import { PlatformPayment } from '../../../modules/billing/entities/platform-payment.entity';
import { SmsCreditLot } from '../../../modules/communications/credits/entities/sms-credit-lot.entity';
import { SmsBundleCatalog } from '../../../modules/sms-bundles/entities/sms-bundle-catalog.entity';
import { SmsBundleOrder } from '../../../modules/sms-bundles/entities/sms-bundle-order.entity';
import { SmsProviderBalanceReading } from '../../../modules/sms-bundles/entities/sms-provider-balance-reading.entity';
import { SmsStockEntry } from '../../../modules/sms-bundles/entities/sms-stock-entry.entity';
import type { DemoSlice } from '../context';
import { orgIds } from './org';

/** [name, sms, validity days, price in whole paisa]. The middle package is the one each school bought. */
const PACKAGES: [string, number, number, number][] = [
  ['ছোট প্যাকেজ — ১,০০০ এসএমএস', 1000, 90, 60000],
  ['মাঝারি প্যাকেজ — ৫,০০০ এসএমএস', 5000, 180, 250000],
  ['বড় প্যাকেজ — ২০,০০০ এসএমএস', 20000, 365, 900000],
];
const BOUGHT = 1;
/** The platform's own cost per SMS (paisa), used for the stock entry and the order snapshot. */
const COST_PER_SMS = 30;

/**
 * [100.1.04] SMS packages, one bundle order per branch (lot + offline-bank payment), one stock
 * entry and one provider balance reading, so the cockpit's SMS screens are never empty.
 *
 * Runs after `comms-print`, which leaves each school a `sms_credit_balance` row. To keep
 * `balance.available = sum(lot remaining)` the existing balance becomes one LEGACY no-expiry
 * lot, then the bundle lot's units are added to the balance. Lots go through the repository:
 * the demo seed is the one reviewed exception to the single-writer rule (as `comms-print` is).
 *
 * `SmsCreditLotDraw` stays in EXEMPT (slices.ts): a fresh demo has nothing in flight, and a fake
 * open draw would hold units that no send will ever settle.
 */
export const slice: DemoSlice = {
  name: 'sms-bundles',
  covers: [
    SmsCreditLot,
    SmsBundleCatalog,
    SmsBundleOrder,
    SmsStockEntry,
    SmsProviderBalanceReading,
  ],
  async run(ctx) {
    const { tenants, adminUserId } = orgIds(ctx);
    let rows = 0;

    const catalog = await ctx.ds.getRepository(SmsBundleCatalog).save(
      PACKAGES.map(([name, sms_count, validity_days, price], i) => ({
        name,
        sms_count,
        validity_days,
        price_paisa: String(price),
        active: true,
        sort_order: i,
        created_by_user_id: adminUserId,
      })),
    );
    rows += catalog.length;
    const pkg = catalog[BOUGHT];
    const price = PACKAGES[BOUGHT][3];

    // Dates are Postgres maths on the anchor: no literal dates.
    const [{ paid, bought }] = await ctx.ds.query(
      `SELECT ($1::date - 3)::text AS paid, ($1::date - 10)::text AS bought`,
      [ctx.anchor],
    );
    const year = paid.slice(0, 4);

    for (const [i, t] of tenants.entries()) {
      const [school]: { name: string; address: string | null }[] = await ctx.ds.query(
        'SELECT name, address FROM schools WHERE id = $1',
        [t.id],
      );
      const order = await ctx.ds.getRepository(SmsBundleOrder).save({
        school_id: t.id,
        catalog_id: pkg.id,
        name_snapshot: pkg.name,
        sms_count: pkg.sms_count,
        validity_days: pkg.validity_days,
        price_paisa: String(price),
        cost_paisa_per_sms: String(COST_PER_SMS),
        status: SmsBundleOrderStatus.ACTIVE,
        idempotency_key: `demo-${t.slug}-sms-1`,
        // Continues after the billing slice's SMR-<year>-000001..n seat receipts.
        receipt_number: `SMR-${year}-${String(tenants.length + i + 1).padStart(6, '0')}`,
        receipt_snapshot: { name: school.name, address: school.address, vat: null },
        created_by_user_id: adminUserId,
        paid_at: new Date(`${paid}T10:00:00+06:00`),
      });
      await ctx.ds.getRepository(PlatformPayment).save({
        seat_order_id: null,
        bundle_order_id: order.id,
        method: PlatformPaymentMethod.OFFLINE_BANK,
        amount_paisa: String(price),
        recorded_by_user_id: adminUserId,
      });

      const [bal]: { available: number }[] = await ctx.ds.query(
        'SELECT available FROM sms_credit_balance WHERE tenant_id = $1',
        [t.id],
      );
      const legacy = bal?.available ?? 0;
      if (legacy > 0) {
        await ctx.ds.getRepository(SmsCreditLot).save({
          tenant_id: t.id,
          source: SmsLotSource.LEGACY,
          units_total: legacy,
          remaining: legacy,
          expires_at: null,
        });
        rows++;
      }
      const [{ expires }] = await ctx.ds.query(
        `SELECT ($1::timestamptz + make_interval(days => $2))::text AS expires`,
        [order.paid_at, pkg.validity_days],
      );
      await ctx.ds.getRepository(SmsCreditLot).save({
        tenant_id: t.id,
        source: SmsLotSource.BUNDLE,
        bundle_order_id: order.id,
        units_total: pkg.sms_count,
        remaining: pkg.sms_count,
        expires_at: new Date(expires),
      });
      await ctx.ds.query(
        `INSERT INTO sms_credit_balance (tenant_id, available, reserved) VALUES ($1, $2, 0)
         ON CONFLICT (tenant_id) DO UPDATE SET available = sms_credit_balance.available + $2`,
        [t.id, pkg.sms_count],
      );
      rows += 3;
    }

    await ctx.ds.getRepository(SmsStockEntry).save({
      bought_on: bought,
      sms_count: 50000,
      cost_paisa: String(50000 * COST_PER_SMS),
      note: 'প্রোভাইডার থেকে টপ-আপ',
      entered_by_user_id: adminUserId,
    });
    await ctx.ds.getRepository(SmsProviderBalanceReading).save({
      sms_balance: 50000,
      entered_by_user_id: adminUserId,
    });
    return rows + 2;
  },
};
