import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { resolveAppBaseUrl } from '../account-access/app-base-url.util';
import { AdminNoticeService } from '../schools/trial/admin-notice.service';

const taka = (paisa: string | number): string => (Number(paisa) / 100).toFixed(2);

/**
 * [100.3.gD-01] Emails to a school's admins for money events. Email only: these must not spend
 * metered platform SMS. Every method never throws, because the money event already stands.
 */
@Injectable()
export class MoneyNoticesService {
  private readonly logger = new Logger(MoneyNoticesService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly notices: AdminNoticeService,
  ) {}

  /** A coupon was redeemed on a seat order. */
  async couponApplied(orderId: string): Promise<void> {
    await this.run('couponApplied', orderId, async () => {
      const [r]: { school_id: string; code: string; discount: string }[] =
        await this.dataSource.query(
          `SELECT o.school_id, c.code, o.discount_paisa::text AS discount
             FROM seat_orders o JOIN coupons c ON c.id = o.coupon_id WHERE o.id = $1`,
          [orderId],
        );
      if (!r) return;
      await this.notices.notifyAdmins(
        r.school_id,
        'coupon_applied',
        { coupon: r.code, amount: taka(r.discount), link: this.billingLink() },
        { emailOnly: true },
      );
    });
  }

  /** A seat or bundle order was refunded (an id lives in one table only). */
  async refundDone(orderId: string): Promise<void> {
    await this.run('refundDone', orderId, async () => {
      const [r]: { school_id: string; amount: string }[] = await this.dataSource.query(
        `SELECT school_id, amount_paisa::text AS amount FROM seat_orders WHERE id = $1 AND refunded_at IS NOT NULL
         UNION ALL
         SELECT school_id, price_paisa::text FROM sms_bundle_orders WHERE id = $1 AND refunded_at IS NOT NULL`,
        [orderId],
      );
      if (!r) return;
      await this.notices.notifyAdmins(
        r.school_id,
        'refund_done',
        { amount: taka(r.amount), link: this.billingLink() },
        { emailOnly: true },
      );
    });
  }

  async planChanged(schoolId: string, planName: string): Promise<void> {
    await this.run('planChanged', schoolId, () =>
      this.notices.notifyAdmins(schoolId, 'plan_changed', { plan: planName }, { emailOnly: true }),
    );
  }

  private billingLink(): string {
    return `${resolveAppBaseUrl(this.config)}/settings?section=billing`;
  }

  private async run(what: string, id: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `${what} notice failed ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
