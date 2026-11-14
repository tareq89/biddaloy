import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { toCsvContent } from '@biddaloy/shared';
import { isAlmostFinished } from '../../communications/credits/sms-low.util';
import { ProviderBalanceReader } from '../stock/provider-balance.reader';
import { SmsAllocationService } from '../stock/sms-allocation.service';
import { buildActionLines } from './sms-action-lines';
import {
  CSV_ROW_CAP,
  REPORT_PAGE_MAX,
  SmsStatePackageRowDto,
  SmsStateReportDto,
  SmsStateSchoolRowDto,
} from './dto/sms-state-report.dto';

/**
 * An order counts as sold once paid. REFUNDED is out (the money went back, the SMS were never
 * delivered); PENDING_PAYMENT and CANCELLED never paid. Filtering on status, not only on
 * `paid_at`, keeps a stray `paid_at` from turning into income.
 */
export const SOLD_STATUSES_SQL = `('PAID','ACTIVE','USED_UP','EXPIRED')`;
const COST_SQL = `ROUND(o.sms_count * COALESCE(o.cost_paisa_per_sms, 0))`;
const BAD_CURSOR = 'Invalid cursor.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPIRY_WINDOW_DAYS = 7;

type Row = Record<string, string | null>;
const n = (v: string | null | undefined) => Number(v ?? 0);

/** [100.2.09] Owner's SMS bought / sold / used report. Read-only; cross-school by design. */
@Injectable()
export class SmsStateReportService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly reader: ProviderBalanceReader,
    private readonly allocation: SmsAllocationService,
  ) {}

  async getReport(limit: number, after?: string): Promise<SmsStateReportDto> {
    const cap = Math.min(Math.max(limit, 1), REPORT_PAGE_MAX);
    const cursor = after ? this.decode(after) : undefined;
    const [balance, promised, totals, packages, lots, page] = await Promise.all([
      this.reader.read(),
      this.allocation.promisedUnused(),
      this.totalsRow(),
      this.packageRows(),
      this.lotRows(),
      this.schoolRows(cap + 1, cursor),
    ]);

    const hasMore = page.length > cap;
    const schools = page.slice(0, cap);
    const bought = n(totals.bought);
    const sold = n(totals.sold);
    const revenue = n(totals.revenue);
    const cost = n(totals.cost);
    const unsold = bought - sold;

    let schoolsLow = 0;
    let expiring = 0;
    for (const l of lots) {
      expiring += n(l.expiring);
      if (
        isAlmostFinished({ remaining: n(l.rem), activeLots: [{ units_total: n(l.tot) }] })
          .almostFinished
      )
        schoolsLow++;
    }

    const kind = balance.source === 'PROVIDER' ? 'AUTO' : balance.source;
    return {
      actionLines: buildActionLines({
        balance: { sms: balance.sms, stale: balance.stale },
        promisedUnusedSms: promised,
        unsoldSms: unsold,
        schoolsLow,
        expiringSms: expiring,
      }),
      balance: {
        sms: balance.sms,
        kind,
        enteredAt: kind === 'ENTERED' && balance.asOf ? balance.asOf.toISOString() : null,
        stale: balance.stale,
      },
      totals: {
        boughtSms: bought,
        soldSms: sold,
        usedSms: n(totals.used),
        expiredSms: n(totals.expired),
        promisedUnusedSms: promised,
        unsoldSms: unsold,
        revenuePaisa: revenue,
        costPaisa: cost,
        marginPaisa: revenue - cost,
      },
      packages,
      schools,
      nextCursor: hasMore ? this.encode(schools[schools.length - 1]) : null,
    };
  }

  /** Every school row in one query, capped. ponytail: past the cap the file just ends; add paging if 20k schools ever happens. */
  async csvRows(): Promise<SmsStateSchoolRowDto[]> {
    return this.schoolRows(CSV_ROW_CAP);
  }

  /** `toCsvContent` adds the BOM and defuses formula cells (a school named `=cmd()`). */
  toCsv(rows: SmsStateSchoolRowDto[]): string {
    const lines: unknown[][] = [
      [
        'School',
        'Orders',
        'SMS sold',
        'SMS used',
        'SMS expired',
        'Revenue (paisa)',
        'Cost (paisa)',
        'Margin (paisa)',
        'Failed SMS (30d)',
        'Sent SMS (30d)',
        'Failure rate (basis points)',
      ],
    ];
    for (const r of rows)
      lines.push([
        r.schoolName,
        r.orders,
        r.soldSms,
        r.usedSms,
        r.expiredSms,
        r.revenuePaisa,
        r.costPaisa,
        r.marginPaisa,
        r.failedSms,
        r.sentSms,
        r.failureRateBp ?? '',
      ]);
    return toCsvContent(lines);
  }

  private async totalsRow(): Promise<Row> {
    const [row] = await this.ds.query(
      `SELECT
         (SELECT COALESCE(SUM(sms_count), 0) FROM sms_stock_entries WHERE deleted_at IS NULL)::text AS bought,
         (SELECT COALESCE(SUM(units), 0) FROM sms_credit_ledger WHERE kind = 'DEBIT')::text AS used,
         (SELECT COALESCE(SUM(units), 0) FROM sms_credit_ledger WHERE kind = 'EXPIRE')::text AS expired,
         COALESCE(SUM(o.sms_count), 0)::text AS sold,
         COALESCE(SUM(o.price_paisa), 0)::text AS revenue,
         COALESCE(SUM(${COST_SQL}), 0)::text AS cost
       FROM sms_bundle_orders o WHERE o.status IN ${SOLD_STATUSES_SQL}`,
    );
    return row;
  }

  private async packageRows(): Promise<SmsStatePackageRowDto[]> {
    const rows: Row[] = await this.ds.query(
      `SELECT o.catalog_id, MAX(o.name_snapshot) AS name, COUNT(*)::text AS orders,
              SUM(o.sms_count)::text AS sold, SUM(o.price_paisa)::text AS revenue,
              SUM(${COST_SQL})::text AS cost
         FROM sms_bundle_orders o WHERE o.status IN ${SOLD_STATUSES_SQL}
        GROUP BY o.catalog_id ORDER BY SUM(o.price_paisa) DESC, o.catalog_id`,
    );
    return rows.map((r) => ({
      catalogId: r.catalog_id!,
      name: r.name!,
      orders: n(r.orders),
      soldSms: n(r.sold),
      revenuePaisa: n(r.revenue),
      costPaisa: n(r.cost),
      marginPaisa: n(r.revenue) - n(r.cost),
    }));
  }

  /** Per PLATFORM-metered school: unexpired ACTIVE lots, as for `promisedUnused`. */
  private lotRows(): Promise<Row[]> {
    return this.ds.query(
      `SELECT l.tenant_id, SUM(l.remaining) AS rem, SUM(l.units_total) AS tot,
              COALESCE(SUM(l.remaining) FILTER (WHERE l.expires_at <= now() + make_interval(days => $1)), 0) AS expiring
         FROM sms_credit_lots l JOIN schools s ON s.id = l.tenant_id
        WHERE l.status = 'ACTIVE' AND (l.expires_at IS NULL OR l.expires_at > now())
          AND s.settings #>> '{communications,sms,metering}' = 'PLATFORM'
        GROUP BY l.tenant_id`,
      [EXPIRY_WINDOW_DAYS],
    );
  }

  /**
   * A school is listed when it has a sold order or has used SMS. Failure counts reuse the
   * `platform-provider-failures` predicate (`status = 'FAILED'`); "sent" is the accepted statuses.
   * ponytail: scans 30 days of communication_logs for all schools; add an index if it shows up.
   */
  private async schoolRows(
    take: number,
    cursor?: { m: number; id: string },
  ): Promise<SmsStateSchoolRowDto[]> {
    const params: unknown[] = [take];
    let keyset = '';
    if (cursor) {
      params.push(cursor.m, cursor.id);
      keyset = `AND (m.margin < $2::bigint OR (m.margin = $2::bigint AND m.id > $3::uuid))`;
    }
    const rows: Row[] = await this.ds.query(
      `WITH ord AS (
         SELECT o.school_id, COUNT(*) AS orders, SUM(o.sms_count) AS sold, SUM(o.price_paisa) AS revenue,
                SUM(${COST_SQL}) AS cost
           FROM sms_bundle_orders o WHERE o.status IN ${SOLD_STATUSES_SQL} GROUP BY o.school_id
       ), led AS (
         SELECT tenant_id, COALESCE(SUM(units) FILTER (WHERE kind = 'DEBIT'), 0) AS used,
                COALESCE(SUM(units) FILTER (WHERE kind = 'EXPIRE'), 0) AS expired
           FROM sms_credit_ledger WHERE kind IN ('DEBIT','EXPIRE') GROUP BY tenant_id
       ), fl AS (
         SELECT tenant_id, COUNT(*) FILTER (WHERE status = 'FAILED') AS failed,
                COUNT(*) FILTER (WHERE status IN ('SENT','DELIVERED','READ')) AS ok
           FROM communication_logs
          WHERE medium = 'SMS' AND created_at >= now() - interval '30 days' GROUP BY tenant_id
       ), m AS (
         SELECT sc.id, sc.name, COALESCE(ord.orders, 0) AS orders, COALESCE(ord.sold, 0) AS sold,
                COALESCE(led.used, 0) AS used, COALESCE(led.expired, 0) AS expired,
                COALESCE(ord.revenue, 0) AS revenue, COALESCE(ord.cost, 0) AS cost,
                (COALESCE(ord.revenue, 0) - COALESCE(ord.cost, 0))::bigint AS margin,
                COALESCE(fl.failed, 0) AS failed, COALESCE(fl.ok, 0) AS ok
           FROM schools sc
           LEFT JOIN ord ON ord.school_id = sc.id
           LEFT JOIN led ON led.tenant_id = sc.id
           LEFT JOIN fl ON fl.tenant_id = sc.id
          WHERE ord.school_id IS NOT NULL OR COALESCE(led.used, 0) > 0
       )
       SELECT m.id, m.name, m.orders::text, m.sold::text, m.used::text, m.expired::text,
              m.revenue::text, m.cost::text, m.margin::text, m.failed::text, m.ok::text
         FROM m WHERE TRUE ${keyset}
        ORDER BY m.margin DESC, m.id ASC LIMIT $1`,
      params,
    );
    return rows.map((r) => {
      const failed = n(r.failed);
      const sent = failed + n(r.ok);
      return {
        schoolId: r.id!,
        schoolName: r.name!,
        orders: n(r.orders),
        soldSms: n(r.sold),
        usedSms: n(r.used),
        expiredSms: n(r.expired),
        revenuePaisa: n(r.revenue),
        costPaisa: n(r.cost),
        marginPaisa: n(r.margin),
        failedSms: failed,
        sentSms: sent,
        failureRateBp: sent === 0 ? null : Math.round((failed * 10_000) / sent),
      };
    });
  }

  private encode(r: SmsStateSchoolRowDto): string {
    return Buffer.from(JSON.stringify({ m: r.marginPaisa, id: r.schoolId })).toString('base64url');
  }

  private decode(s: string): { m: number; id: string } {
    try {
      const v = JSON.parse(Buffer.from(s, 'base64url').toString('utf-8'));
      if (Number.isSafeInteger(v?.m) && typeof v?.id === 'string' && UUID.test(v.id))
        return { m: v.m, id: v.id };
    } catch {
      // fall through to the fixed answer
    }
    throw new BadRequestException(BAD_CURSOR);
  }
}
