import { DataSource } from 'typeorm';

/**
 * [100.3.gD-01] e2e dev seed (not the demo seed): a second plan and two known coupons, so the
 * money journeys (#3894) have fixed values. Platform-wide rows, no school. Idempotent: every
 * insert is `ON CONFLICT DO NOTHING` (plan name / coupon code are unique), so a re-run, or a
 * hand-edited row, is left alone.
 *
 *   plan   'Plus'      unit price 1500 paisa, active
 *   coupon E2E-HALF    50 percent, scope ALL, max 3 months
 *   coupon E2E-FREE    100 percent, scope ALL
 */
export async function ensureMoneySeed(ds: Pick<DataSource, 'query'>): Promise<void> {
  await ds.query(
    `INSERT INTO plans (name, unit_price_paisa, active, is_default)
     VALUES ('Plus', 1500, true, false) ON CONFLICT DO NOTHING`,
  );
  await ds.query(
    `INSERT INTO coupons (code, discount_kind, percent, max_months, scope, starts_at, ends_at)
     VALUES ('E2E-HALF', 'PERCENT', 50, 3, 'ALL', now(), now() + interval '10 years'),
            ('E2E-FREE', 'PERCENT', 100, NULL, 'ALL', now(), now() + interval '10 years')
     ON CONFLICT DO NOTHING`,
  );
}
