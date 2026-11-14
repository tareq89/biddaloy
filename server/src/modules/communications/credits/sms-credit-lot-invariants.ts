import { DataSource } from 'typeorm';

export interface LotInvariantRow {
  tenantId: string;
  available: number;
  lotsRemaining: number;
  reserved: number;
  openDraws: number;
  lotsBroken: string[];
}

export const isLotSchoolOk = (r: LotInvariantRow): boolean =>
  r.available === r.lotsRemaining && r.reserved === r.openDraws && r.lotsBroken.length === 0;

/**
 * [#3853] Read-only. Per school with a balance row or lots: does `available` equal the sum of
 * the lots, do `reserved` units equal the open draws, and is every lot internally consistent
 * (counters sum to `units_total`; status agrees with the counters)? Writes nothing.
 */
export async function checkLotInvariants(
  dataSource: DataSource,
  opts: { tenantId?: string } = {},
): Promise<LotInvariantRow[]> {
  const rows: Array<{
    tenant_id: string;
    available: string | number;
    lots_remaining: string | number;
    reserved: string | number;
    open_draws: string | number;
    lots_broken: string[];
  }> = await dataSource.query(
    `WITH tenants AS (
       SELECT tenant_id FROM "sms_credit_balance"
       UNION SELECT tenant_id FROM "sms_credit_lots"
     ),
     lot_sums AS (
       SELECT tenant_id,
              SUM(remaining)::bigint AS lots_remaining,
              COALESCE(array_agg(id::text ORDER BY id) FILTER (WHERE
                remaining + reserved_units + debited_units + expired_units <> units_total
                OR (status IN ('USED_UP', 'EXPIRED') AND remaining + reserved_units > 0)
                OR (status = 'ACTIVE' AND remaining = 0 AND reserved_units = 0)
              ), '{}') AS lots_broken
         FROM "sms_credit_lots" GROUP BY tenant_id
     ),
     draw_sums AS (
       SELECT tenant_id, SUM(open_units)::bigint AS open_draws
         FROM "sms_credit_lot_draws" GROUP BY tenant_id
     )
     SELECT t.tenant_id,
            COALESCE(b.available, 0) AS available,
            COALESCE(l.lots_remaining, 0) AS lots_remaining,
            COALESCE(b.reserved, 0) AS reserved,
            COALESCE(d.open_draws, 0) AS open_draws,
            COALESCE(l.lots_broken, '{}') AS lots_broken
       FROM tenants t
       LEFT JOIN "sms_credit_balance" b ON b.tenant_id = t.tenant_id
       LEFT JOIN lot_sums l ON l.tenant_id = t.tenant_id
       LEFT JOIN draw_sums d ON d.tenant_id = t.tenant_id
      WHERE ($1::uuid IS NULL OR t.tenant_id = $1::uuid)
      ORDER BY t.tenant_id`,
    [opts.tenantId ?? null],
  );
  return rows.map((r) => ({
    tenantId: r.tenant_id,
    available: Number(r.available),
    lotsRemaining: Number(r.lots_remaining),
    reserved: Number(r.reserved),
    openDraws: Number(r.open_draws),
    lotsBroken: r.lots_broken,
  }));
}
