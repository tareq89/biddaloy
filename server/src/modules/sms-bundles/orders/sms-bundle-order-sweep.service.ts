import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SmsBundleOrderStatus } from '@biddaloy/shared';

/** D22: an unpaid order is dead after 24 h (same window as bKash `RECONCILE_WINDOW_MS`). */
export const STALE_ORDER_MS = 24 * 60 * 60 * 1000;

/**
 * A method only; #3858 calls it from the bKash reconcile pass, so no queue is registered here.
 * ponytail: no payment table links to an SMS order yet, so "no live payment" is just
 * "still PENDING_PAYMENT"; #3858 adds the payment-link predicate when it adds the link.
 */
@Injectable()
export class SmsBundleOrderSweepService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** One UPDATE; returns how many orders were cancelled. */
  async cancelStale(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_ORDER_MS);
    const [, count]: [unknown, number] = await this.ds.query(
      `UPDATE sms_bundle_orders SET status = $1, cancelled_at = $3, updated_at = $3
        WHERE status = $2 AND created_at < $4`,
      [SmsBundleOrderStatus.CANCELLED, SmsBundleOrderStatus.PENDING_PAYMENT, now, cutoff],
    );
    return count;
  }
}
