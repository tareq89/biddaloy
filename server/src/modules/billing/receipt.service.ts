import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { resolveAppBaseUrl } from '../account-access/app-base-url.util';
import { resolveTemplateLocale } from '../account-access/account-access-templates';
import { DEFAULT_REGION_SETTINGS } from '../schools/settings/tenant-settings-defaults';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { renderBundleReceiptHtml, renderReceiptHtml } from './receipt.template';

interface ReceiptRow {
  school_id: string;
  receipt_number: string;
  id: string;
  seats: number;
  months: number;
  unit_price_paisa: number;
  amount_paisa: string;
  period_start: string;
  period_end: string;
  paid_at: Date;
  receipt_snapshot: { name: string; address: string | null; vat: string | null } | null;
  name: string;
  address: string | null;
  locale: string | null;
  method: string | null;
  reference: string | null;
}

/** The platform receipt for a paid seat order (Epic 49 D11): numbered `SMR-YYYY-NNNNNN`, A4 HTML. */
@Injectable()
export class ReceiptService {
  private readonly logger = new Logger(ReceiptService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly notices: AdminNoticeService,
  ) {}

  /** 404 for an unknown order, another school's order, or one with no receipt (unpaid, GRANT). */
  async renderForSchool(schoolId: string, orderId: string): Promise<string> {
    const [r]: ReceiptRow[] = await this.dataSource.query(
      `SELECT o.id, o.school_id, o.receipt_number, o.seats, o.months, o.unit_price_paisa,
              o.amount_paisa, o.period_start::text AS period_start, (o.period_end - 1)::text AS period_end,
              o.paid_at, o.receipt_snapshot, s.name, s.address, s.settings #>> '{region,locale}' AS locale,
              p.method, p.gateway_ref AS reference
         FROM seat_orders o
         JOIN schools s ON s.id = o.school_id
         LEFT JOIN LATERAL (SELECT method, gateway_ref FROM platform_payments
                             WHERE seat_order_id = o.id AND (raw->>'orphan') IS DISTINCT FROM 'true'
                             ORDER BY created_at DESC LIMIT 1) p ON true
        WHERE o.id = $1 AND o.school_id = $2 AND o.status = 'PAID' AND o.receipt_number IS NOT NULL`,
      [orderId, schoolId],
    );
    if (!r) throw new NotFoundException('Receipt not found');
    return renderReceiptHtml({
      receiptNumber: r.receipt_number,
      orderId: r.id,
      // Frozen at payment; the live school row only fills in rows that predate the snapshot.
      schoolName: r.receipt_snapshot?.name ?? r.name,
      schoolAddress: r.receipt_snapshot ? r.receipt_snapshot.address : r.address,
      seats: r.seats,
      months: r.months,
      unitPricePaisa: r.unit_price_paisa,
      amountPaisa: Number(r.amount_paisa),
      periodStart: r.period_start,
      periodEnd: r.period_end,
      method: r.method ?? '',
      reference: r.reference,
      paidAt: r.paid_at,
      // Stored as `bn-BD`/`en-BD`; no stored region means the bn-BD default (#3041).
      locale: resolveTemplateLocale(r.locale ?? DEFAULT_REGION_SETTINGS.locale),
      vatRegistration: r.receipt_snapshot?.vat ?? null,
    });
  }

  /** Bundle twin of `renderForSchool`. Paid means numbered: ACTIVE, EXPIRED and REFUNDED keep their receipt. */
  async renderBundleForSchool(schoolId: string, orderId: string): Promise<string> {
    const [r]: {
      id: string;
      receipt_number: string;
      name_snapshot: string;
      sms_count: number;
      validity_days: number;
      price_paisa: string;
      expires_on: string;
      paid_at: Date;
      receipt_snapshot: { name: string; address: string | null } | null;
      name: string;
      address: string | null;
      locale: string | null;
      method: string | null;
      reference: string | null;
    }[] = await this.dataSource.query(
      `SELECT o.id, o.receipt_number, o.name_snapshot, o.sms_count, o.validity_days,
              o.price_paisa::text AS price_paisa, o.paid_at, o.receipt_snapshot,
              ((o.paid_at + make_interval(days => o.validity_days)) AT TIME ZONE 'Asia/Dhaka')::date::text AS expires_on,
              s.name, s.address, s.settings #>> '{region,locale}' AS locale,
              p.method, p.gateway_ref AS reference
         FROM sms_bundle_orders o
         JOIN schools s ON s.id = o.school_id
         LEFT JOIN LATERAL (SELECT method, gateway_ref FROM platform_payments
                             WHERE bundle_order_id = o.id AND (raw->>'orphan') IS DISTINCT FROM 'true'
                             ORDER BY created_at DESC LIMIT 1) p ON true
        WHERE o.id = $1 AND o.school_id = $2 AND o.receipt_number IS NOT NULL`,
      [orderId, schoolId],
    );
    if (!r) throw new NotFoundException('Receipt not found');
    return renderBundleReceiptHtml({
      receiptNumber: r.receipt_number,
      orderId: r.id,
      schoolName: r.receipt_snapshot?.name ?? r.name,
      schoolAddress: r.receipt_snapshot ? r.receipt_snapshot.address : r.address,
      packageName: r.name_snapshot,
      smsCount: r.sms_count,
      validityDays: r.validity_days,
      amountPaisa: Number(r.price_paisa),
      expiresOn: r.expires_on,
      method: r.method ?? '',
      reference: r.reference,
      paidAt: r.paid_at,
      locale: resolveTemplateLocale(r.locale ?? DEFAULT_REGION_SETTINGS.locale),
      vatLine: null, // #3869
      couponLine: null,
    });
  }

  /** Emails the school's admins a link to the receipt. Never throws: the payment already stands. */
  async emailReceipt(orderId: string): Promise<void> {
    try {
      // An id lives in one table only (both are random uuids): seat order first, then bundle.
      const [o]: { school_id: string; receipt_number: string | null; bundle: boolean }[] =
        await this.dataSource.query(
          `SELECT school_id, receipt_number, false AS bundle FROM seat_orders WHERE id = $1
           UNION ALL
           SELECT school_id, receipt_number, true FROM sms_bundle_orders WHERE id = $1`,
          [orderId],
        );
      if (!o?.receipt_number) return;
      const base = resolveAppBaseUrl(this.config);
      await this.notices.notifyAdmins(
        o.school_id,
        'receipt',
        {
          link: o.bundle
            ? `${base}/settings?section=communication&smsOrder=${orderId}`
            : `${base}/settings?section=billing`,
          receipt: o.receipt_number,
        },
        { emailOnly: true },
      );
    } catch (err) {
      this.logger.error(
        `Receipt email failed order ${orderId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
