import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SmsBundleOrderStatus } from '@biddaloy/shared';
import { BkashService } from '../../billing/bkash/bkash.service';

/** D22: an unpaid order is dead after 24 h (same window as bKash `RECONCILE_WINDOW_MS`). */
export const STALE_ORDER_MS = 24 * 60 * 60 * 1000;

/**
 * A method only; the bKash reconciler calls it after `reconcilePending`, so no queue is registered
 * here. Payments live in Redis while in flight and reach `platform_payments` only on completion,
 * so an order is skipped when bKash may still complete a payment for it, and (DB backstop) when
 * any payment row links it.
 */
@Injectable()
export class SmsBundleOrderSweepService {
  private readonly logger = new Logger(SmsBundleOrderSweepService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly bkash: BkashService,
  ) {}

  /** Returns how many orders were cancelled. Redis unreadable: stops, never cancels blind. */
  async cancelStale(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_ORDER_MS);
    const rows: { id: string }[] = await this.ds.query(
      `SELECT o.id FROM sms_bundle_orders o WHERE o.status = $1 AND o.created_at < $2
          AND NOT EXISTS (SELECT 1 FROM platform_payments p WHERE p.bundle_order_id = o.id)`,
      [SmsBundleOrderStatus.PENDING_PAYMENT, cutoff],
    );
    let cancelled = 0;
    for (const { id } of rows) {
      try {
        if (await this.bkash.paymentMayBeLive(id)) continue;
      } catch (err) {
        this.logger.warn(`SMS order sweep stopped, bKash state unreadable: ${String(err)}`);
        return cancelled;
      }
      const [, count]: [unknown, number] = await this.ds.query(
        `UPDATE sms_bundle_orders o SET status = $1, cancelled_at = $3, updated_at = $3
          WHERE o.id = $4 AND o.status = $2
            AND NOT EXISTS (SELECT 1 FROM platform_payments p WHERE p.bundle_order_id = o.id)`,
        [SmsBundleOrderStatus.CANCELLED, SmsBundleOrderStatus.PENDING_PAYMENT, now, id],
      );
      cancelled += count;
    }
    return cancelled;
  }
}
