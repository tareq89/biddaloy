import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import type Redis from 'ioredis';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { PlatformPaymentMethod, SeatOrderStatus, SmsBundleOrderStatus } from '@biddaloy/shared';
import { OTP_REDIS } from '../../account-access/otp.service';
import { resolveAppBaseUrl } from '../../account-access/app-base-url.util';
import { SmsBundlePaymentService } from '../../sms-bundles/payment/sms-bundle-payment.service';
import { OrdersService } from '../orders.service';
import { BkashClient, bdtToPaisa, type BkashPayment } from './bkash.client';

/** order id -> the one bKash payment started for it, so a callback can be matched and reconciled. */
export const PAYMENT_KEY = (orderId: string) => `bkash:pay:${orderId}`;
/** paymentID -> order id, so a callback for a paymentID we never made costs no bKash call. */
const PID_KEY = (paymentID: string) => `bkash:pid:${paymentID}`;
const PAYMENT_TTL_SEC = 25 * 60 * 60;
/** Held only while bKash `create` is in flight: the SET NX lock against a double start. */
const CREATING_KEY = (orderId: string) => `bkash:creating:${orderId}`;
const CREATING_TTL_SEC = 60;
/** bKash paymentIDs are short alphanumeric tokens (e.g. TR0011ON1565154754797). */
const PAYMENT_ID_SHAPE = /^[A-Za-z0-9]{1,64}$/;
/** CHK_platform_payments_amount upper bound. */
const MAX_AMOUNT_PAISA = 9_999_999_999n;
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_QUERY_DELAY_MS = 1000;

interface PaymentState {
  paymentID?: string;
  bkash_url?: string;
  pay_started_at: string;
  /** bKash itself reported this payment Cancelled/Failed: it can never complete. */
  dead?: boolean;
  /** Earlier payments of this order that are not known dead (a "success" that never completed):
   * bKash may still complete one, so a callback / the reconciler must still accept it (#2782 F1). */
  earlier?: string[];
}

/** What a bKash payment pays for: a seat order or an SMS bundle order. */
export type PayableKind = 'SEAT' | 'BUNDLE';

export interface Payable {
  kind: PayableKind;
  id: string;
  school_id: string;
  amount_paisa: string;
  /** Waiting for payment (seat PENDING / bundle PENDING_PAYMENT). */
  pending: boolean;
}

export type CallbackOutcome = 'success' | 'cancel' | 'failure';

/** `details.code` of the pay route's two 409s: the client retries one and starts over on the other. */
export const PAY_CONFLICT = {
  /** The order is PAID / FAILED / ...: make a new order (new idempotency key). */
  ORDER_NOT_PENDING: 'ORDER_NOT_PENDING',
  /** Another request is creating this order's payment right now: press Pay again, same order. */
  PAYMENT_STARTING: 'PAYMENT_STARTING',
} as const;

@Injectable()
export class BkashService {
  private readonly logger = new Logger(BkashService.name);

  constructor(
    private readonly client: BkashClient,
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(OTP_REDIS) private readonly redis: Redis,
    // Lazy: the bundle services live in SmsBundlesModule, which imports this module.
    private readonly moduleRef?: ModuleRef,
  ) {}

  private bundlePay(): SmsBundlePaymentService {
    return this.moduleRef!.get(SmsBundlePaymentService, { strict: false });
  }

  /**
   * The order a bKash payment pays for. With `kind` only that table is read; without it (a
   * callback / the reconciler know only the id) a seat order is tried first, then a bundle order.
   */
  async payableOf(orderId: string, kind?: PayableKind): Promise<Payable | undefined> {
    if (kind !== 'BUNDLE') {
      const seat = await this.orders.findForPayment(orderId);
      if (seat) {
        return {
          kind: 'SEAT',
          id: seat.id,
          school_id: seat.school_id,
          amount_paisa: seat.amount_paisa,
          pending: seat.status === SeatOrderStatus.PENDING,
        };
      }
      if (kind === 'SEAT') return undefined;
    }
    const [row]: { id: string; school_id: string; amount_paisa: string; status: string }[] =
      await this.dataSource.query(
        `SELECT id, school_id, price_paisa::text AS amount_paisa, status FROM sms_bundle_orders WHERE id = $1`,
        [orderId],
      );
    return (
      row && {
        kind: 'BUNDLE',
        id: row.id,
        school_id: row.school_id,
        amount_paisa: row.amount_paisa,
        pending: row.status === SmsBundleOrderStatus.PENDING_PAYMENT,
      }
    );
  }

  private billingUrl(query: string): string {
    return `${resolveAppBaseUrl(this.config)}/settings?section=billing&${query}`;
  }

  /** Where the browser lands after bKash: Settings billing, showing this order and how it went. */
  returnUrl(orderId: string, payment: CallbackOutcome): string {
    return this.billingUrl(`order=${orderId}&payment=${payment}`);
  }

  /** The same page with a generic error; never says why (Rule 23). */
  errorUrl(): string {
    return this.billingUrl('payment=error');
  }

  private async readState(orderId: string): Promise<PaymentState | undefined> {
    const raw = await this.redis.get(PAYMENT_KEY(orderId));
    return raw ? (JSON.parse(raw) as PaymentState) : undefined;
  }

  /**
   * True while a bKash payment for this order is being created, or was started under 24 h ago
   * (the reconciler's window): bKash may still complete it. Redis errors propagate.
   */
  async paymentMayBeLive(orderId: string): Promise<boolean> {
    if ((await this.redis.exists(CREATING_KEY(orderId))) > 0) return true;
    const state = await this.readState(orderId);
    const maybeLive = (!!state?.paymentID && !state.dead) || !!state?.earlier?.length;
    return maybeLive && Date.now() - Date.parse(state!.pay_started_at) <= RECONCILE_WINDOW_MS;
  }

  /** Creates the bKash payment for one of the school's PENDING orders; returns the URL to send the admin to. */
  async startPayment(
    schoolId: string,
    orderId: string,
    kind: PayableKind = 'SEAT',
  ): Promise<{ bkash_url: string }> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('Online payment is not available right now.');
    }
    const order = await this.payableOf(orderId, kind);
    // Another school's order is a 404, never a hint that it exists.
    if (!order || order.school_id !== schoolId) throw new NotFoundException('Order not found');
    if (!order.pending) {
      throw new ConflictException({
        message: 'This order is not waiting for payment.',
        details: { code: PAY_CONFLICT.ORDER_NOT_PENDING },
      });
    }
    // A payment is already live for this order: hand back its page, never make a second one.
    const live = await this.readState(orderId);
    if (live?.bkash_url) return { bkash_url: live.bkash_url };
    // D8: no new package payment while sales are paused (a payment already taken is never refused).
    if (kind === 'BUNDLE') await this.bundlePay().assertSalesOpen();
    // A Redis error here fails the start (no payment without somewhere to remember it).
    const won = await this.redis.set(CREATING_KEY(orderId), '1', 'EX', CREATING_TTL_SEC, 'NX');
    if (won !== 'OK') {
      throw new ConflictException({
        message: 'A payment is already starting for this order.',
        details: { code: PAY_CONFLICT.PAYMENT_STARTING },
      });
    }
    try {
      // Another start may have finished between the read above and the lock.
      const now = await this.readState(orderId);
      if (now?.bkash_url) return { bkash_url: now.bkash_url };
      return await this.createPayment(schoolId, order, now);
    } finally {
      await this.redis.del(CREATING_KEY(orderId)).catch(() => undefined);
    }
  }

  /**
   * `previous` is a payment that came back cancelled or failed (its checkout URL was dropped).
   * Its paymentID stays in the state, for the reconciler, until the new one replaces it.
   */
  private async createPayment(
    schoolId: string,
    order: Payable,
    previous: PaymentState | undefined,
  ): Promise<{ bkash_url: string }> {
    const orderId = order.id;
    let created: BkashPayment;
    try {
      created = await this.client.create({
        amountPaisa: order.amount_paisa,
        orderId,
        callbackUrl: `${resolveAppBaseUrl(this.config)}/api/v1/billing/bkash/callback`,
        payerReference: schoolId,
      });
    } catch (err) {
      this.logger.error(`bKash create failed for order ${orderId}: ${errMessage(err)}`);
      throw new ServiceUnavailableException('Online payment is not available right now.');
    }
    if (created.statusCode !== '0000' || !created.paymentID || !created.bkashURL) {
      // No paymentID was ever stored for this order: closing it is safe.
      // (A stored paymentID means a payment may exist, and then the order must stay PENDING.)
      // (A bundle order has no FAILED state: it stays PENDING_PAYMENT and the 24 h sweep cancels it.)
      if (!previous?.paymentID && order.kind === 'SEAT') await this.orders.markFailed(orderId);
      this.logger.error(`bKash create refused for order ${orderId}: code ${created.statusCode}`);
      throw new ServiceUnavailableException('Online payment is not available right now.');
    }
    const state: PaymentState = {
      pay_started_at: new Date().toISOString(),
      paymentID: created.paymentID,
      bkash_url: created.bkashURL,
      earlier: [
        ...(previous?.earlier ?? []),
        ...(previous?.paymentID && !previous.dead ? [previous.paymentID] : []),
      ].slice(-5), // ponytail: remembers the last 5 earlier attempts; raise the cap if admins retry more
    };
    await this.redis.set(PID_KEY(created.paymentID), orderId, 'EX', PAYMENT_TTL_SEC);
    await this.redis.set(PAYMENT_KEY(orderId), JSON.stringify(state), 'EX', PAYMENT_TTL_SEC);
    return { bkash_url: created.bkashURL };
  }

  /**
   * The browser came back from bKash. Nothing in the URL is trusted; it only names a payment.
   * Order of checks: the paymentID has bKash's shape and is one we created (Redis; no outbound
   * call otherwise), bKash's query names that same order as its invoice number, the order is
   * PENDING and this paymentID is the one we started, and only then execute.
   * Anything off throws a generic 400 (Rule 23) and changes nothing.
   */
  async handleCallback(
    paymentID: string,
    status: string,
  ): Promise<{ orderId: string; outcome: CallbackOutcome }> {
    const outcome: CallbackOutcome =
      status === 'success' ? 'success' : status === 'cancel' ? 'cancel' : 'failure';
    if (!PAYMENT_ID_SHAPE.test(paymentID)) throw new BadRequestException('Payment not found');
    const ourOrderId = await this.redis.get(PID_KEY(paymentID)).catch((err) => {
      this.logger.error(`bKash callback could not read payment state: ${errMessage(err)}`);
      return null;
    });
    if (!ourOrderId) throw new BadRequestException('Payment not found');
    let known: BkashPayment;
    try {
      known = await this.client.query(paymentID);
    } catch (err) {
      this.logger.error(`bKash callback query failed: ${errMessage(err)}`);
      throw new BadRequestException('Payment not found');
    }
    const orderId = known.merchantInvoiceNumber;
    if (known.statusCode !== '0000' || !orderId || !isUUID(orderId) || orderId !== ourOrderId) {
      throw new BadRequestException('Payment not found');
    }
    const order = await this.payableOf(orderId);
    const state = await this.readState(orderId).catch((err) => {
      this.logger.error(`bKash callback could not read payment state: ${errMessage(err)}`);
      return undefined;
    });
    const isLatest = state?.paymentID === paymentID;
    if (!order || !state || !(isLatest || state.earlier?.includes(paymentID))) {
      this.logger.error(`bKash callback paymentID does not match order ${orderId}`);
      throw new BadRequestException('Payment not found');
    }
    // A replay after PAID (or any non-PENDING order) shows the result and executes nothing.
    if (!order.pending) {
      if (isLatest) return { orderId, outcome };
      // An earlier payment of an order settled another way: if bKash completed it, that money
      // needs the orphan row (refund_due alert). The URL's `status` is never reported as success.
      if (known.transactionStatus === 'Completed') {
        await this.applyCompleted(known).catch((err) =>
          this.logger.warn(`bKash late payment recorded as orphan: ${errMessage(err)}`),
        );
      }
      return { orderId, outcome: outcome === 'cancel' ? 'cancel' : 'failure' };
    }
    if (outcome === 'success') {
      const tx = await this.settle(paymentID, known);
      if (tx?.transactionStatus === 'Completed') {
        await this.applyCompleted(tx);
        return { orderId, outcome };
      }
    }
    if (state && isLatest) {
      // Cancelled, failed, or "success" that did not complete: that checkout page is dead, so the
      // next Pay must create a new payment, not hand it back. The paymentID stays, so the
      // reconciler can still settle it if bKash completes it after all.
      const { bkash_url: _dead, ...rest } = state;
      // Only bKash's own word marks it dead (the URL's `status` is not trusted).
      const gone = ['Cancelled', 'Failed'].includes(known.transactionStatus ?? '');
      // ponytail: read-modify-write on the state, a concurrent start can lose this `dead` flag (the
      // order then stays "maybe live" up to 24 h, the safe side).
      const kept = gone ? { ...rest, dead: true } : rest;
      await this.redis
        .set(PAYMENT_KEY(orderId), JSON.stringify(kept), 'KEEPTTL')
        .catch((err) =>
          this.logger.warn(`bKash could not drop a dead checkout URL: ${errMessage(err)}`),
        );
    }
    // A "success" that did not complete is not a success.
    return { orderId, outcome: outcome === 'success' ? 'failure' : outcome };
  }

  /** Already Completed per query: use it. Else execute; if that errs, wait a beat and query once more. */
  private async settle(paymentID: string, known: BkashPayment): Promise<BkashPayment | undefined> {
    if (known.transactionStatus === 'Completed') return known;
    try {
      const executed = await this.client.execute(paymentID);
      if (executed.transactionStatus === 'Completed' && executed.statusCode === '0000') {
        return executed;
      }
    } catch (err) {
      this.logger.warn(`bKash execute failed, querying instead: ${errMessage(err)}`);
    }
    await new Promise((r) => setTimeout(r, RETRY_QUERY_DELAY_MS));
    try {
      return await this.client.query(paymentID);
    } catch (err) {
      this.logger.warn(`bKash re-query failed: ${errMessage(err)}`);
      return undefined;
    }
  }

  /**
   * Marks the order paid only when the completed transaction matches this order exactly.
   * bKash holds the money by now, so the two paths that pay nothing (a mismatch, or an order no
   * longer PENDING) still record it: an orphan `platform_payments` row (`raw.orphan`), which the
   * `platform.bkash.refund_due` alert shows the platform SUPER_ADMIN until it is refunded.
   */
  private async applyCompleted(tx: BkashPayment): Promise<void> {
    const order = await this.payableOf(tx.merchantInvoiceNumber as string);
    const paid = bdtToPaisa(tx.amount);
    if (!order || !tx.trxID || tx.currency !== 'BDT' || paid !== BigInt(order.amount_paisa)) {
      this.logger.error(
        `bKash completed payment does not match order (order ${tx.merchantInvoiceNumber ?? '-'}, trx ${tx.trxID ?? '-'}): refund needed`,
      );
      if (order) await this.recordOrphan(order, tx, 'MISMATCH');
      throw new BadRequestException('Payment not found');
    }
    // Idempotent: a replay finds the order PAID, records no second payment.
    const payment = {
      method: PlatformPaymentMethod.BKASH,
      gateway_ref: tx.trxID,
      amount_paisa: order.amount_paisa,
      raw: rawOf(tx),
    };
    const { applied } =
      order.kind === 'BUNDLE'
        ? await this.bundlePay().markPaid(order.id, payment)
        : await this.orders.markPaid(order.id, payment);
    if (!applied) {
      // Callback and reconciler raced (same trxID: the orphan insert is a no-op), or a payment
      // completed for an order already settled another way (a double payment to refund).
      this.logger.error(
        `bKash payment completed but order ${order.id} was not PENDING (trx ${tx.trxID}): check for a double payment`,
      );
      await this.recordOrphan(order, tx, 'ORDER_NOT_PENDING');
    }
  }

  /** Keyed on (BKASH, trxID): a replay, or the payment that did pay the order, inserts nothing. */
  private async recordOrphan(
    order: Payable,
    tx: BkashPayment,
    reason: 'MISMATCH' | 'ORDER_NOT_PENDING',
  ): Promise<void> {
    const ref = tx.trxID ?? (tx.paymentID ? `paymentID:${tx.paymentID}` : undefined);
    if (!ref) return;
    const paisa = bdtToPaisa(tx.amount);
    try {
      // Two fixed statements (Rule 4): CHK_platform_payments_one_order wants exactly one column.
      const insert =
        order.kind === 'BUNDLE'
          ? `INSERT INTO platform_payments (bundle_order_id, method, gateway_ref, amount_paisa, raw)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (method, gateway_ref) DO NOTHING`
          : `INSERT INTO platform_payments (seat_order_id, method, gateway_ref, amount_paisa, raw)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (method, gateway_ref) DO NOTHING`;
      await this.dataSource.query(insert, [
        order.id,
        PlatformPaymentMethod.BKASH,
        ref,
        paisa !== undefined && paisa <= MAX_AMOUNT_PAISA ? paisa.toString() : '0',
        JSON.stringify({ ...rawOf(tx), orphan: true, orphan_reason: reason }),
      ]);
    } catch (err) {
      this.logger.error(
        `bKash orphan payment NOT recorded (order ${order.id}, trx ${ref}): ${errMessage(err)}`,
      );
    }
  }

  /** Every 10 min: PENDING orders whose payment started in the last 24 h and never settled. */
  async reconcilePending(): Promise<number> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM seat_orders WHERE status = $1 AND created_at > now() - interval '72 hours'
       UNION ALL
       SELECT id FROM sms_bundle_orders WHERE status = $2 AND created_at > now() - interval '72 hours'`,
      [SeatOrderStatus.PENDING, SmsBundleOrderStatus.PENDING_PAYMENT],
    );
    let paid = 0;
    for (const { id } of rows) {
      try {
        const state = await this.readState(id);
        if (!state) continue;
        if (Date.now() - Date.parse(state.pay_started_at) > RECONCILE_WINDOW_MS) continue;
        const ids = [
          ...(state.dead || !state.paymentID ? [] : [state.paymentID]),
          ...(state.earlier ?? []),
        ];
        // Every id is asked, so a second Completed one is recorded (as an orphan) too; one
        // failing id must not skip the others.
        for (const pid of ids) {
          try {
            const tx = await this.client.query(pid);
            if (tx.transactionStatus === 'Completed' && tx.merchantInvoiceNumber === id) {
              await this.applyCompleted(tx);
              paid++;
            }
          } catch (err) {
            this.logger.warn(`bKash reconcile skipped payment of order ${id}: ${errMessage(err)}`);
          }
        }
      } catch (err) {
        this.logger.warn(`bKash reconcile skipped order ${id}: ${errMessage(err)}`);
      }
    }
    return paid;
  }
}

/** What we keep of a bKash transaction (no payer details). */
function rawOf(tx: BkashPayment): Record<string, unknown> {
  return {
    paymentID: tx.paymentID ?? null,
    trxID: tx.trxID ?? null,
    amount: tx.amount,
    currency: tx.currency,
    transactionStatus: tx.transactionStatus,
    merchantInvoiceNumber: tx.merchantInvoiceNumber,
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
