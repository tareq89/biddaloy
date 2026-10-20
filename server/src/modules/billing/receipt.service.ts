import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { resolveAppBaseUrl } from '../account-access/app-base-url.util';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';
import { renderReceiptHtml } from './receipt.template';

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
                             WHERE seat_order_id = o.id ORDER BY created_at DESC LIMIT 1) p ON true
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
      locale: r.locale === 'bn' ? 'bn' : 'en',
      vatRegistration: r.receipt_snapshot?.vat ?? null,
    });
  }

  /** Emails the school's admins a link to the receipt. Never throws: the payment already stands. */
  async emailReceipt(orderId: string): Promise<void> {
    try {
      const [o]: { school_id: string; receipt_number: string | null }[] =
        await this.dataSource.query(
          'SELECT school_id, receipt_number FROM seat_orders WHERE id = $1',
          [orderId],
        );
      if (!o?.receipt_number) return;
      await this.notices.notifyAdmins(
        o.school_id,
        'receipt',
        {
          link: `${resolveAppBaseUrl(this.config)}/settings?section=billing`,
          receipt: o.receipt_number,
        },
        { emailOnly: true },
      );
    } catch (err) {
      this.logger.error(
        `Receipt email failed for order ${orderId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
