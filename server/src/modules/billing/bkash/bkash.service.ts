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
import { DataSource } from 'typeorm';
import { PlatformPaymentMethod, SeatOrderStatus } from '@biddaloy/shared';
import { OTP_REDIS } from '../../account-access/otp.service';
import { resolveAppBaseUrl } from '../../account-access/app-base-url.util';
import { OrdersService } from '../orders.service';
import { BkashClient, bdtToPaisa, type BkashPayment } from './bkash.client';

/** order id -> the one bKash payment started for it, so a callback can be matched and reconciled. */
const PAYMENT_KEY = (orderId: string) => `bkash:pay:${orderId}`;
const PAYMENT_TTL_SEC = 25 * 60 * 60;
/** Held only while bKash `create` is in flight; also the SET NX lock against a double start. */
const CREATING_TTL_SEC = 60;
const RECONCILE_WINDOW_MS = 24 * 60 * 60 * 1000;
const RETRY_QUERY_DELAY_MS = 1000;

interface PaymentState {
  paymentID?: string;
  bkash_url?: string;
  pay_started_at: string;
}

export type CallbackOutcome = 'success' | 'cancel' | 'failure';

@Injectable()
export class BkashService {
  private readonly logger = new Logger(BkashService.name);

  constructor(
    private readonly client: BkashClient,
    private readonly orders: OrdersService,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(OTP_REDIS) private readonly redis: Redis,
  ) {}

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

  /** Creates the bKash payment for one of the school's PENDING orders; returns the URL to send the admin to. */
  async startPayment(schoolId: string, orderId: string): Promise<{ bkash_url: string }> {
    if (!this.client.isConfigured()) {
      throw new ServiceUnavailableException('Online payment is not available right now.');
    }
    const order = await this.orders.findForPayment(orderId);
    // Another school's order is a 404, never a hint that it exists.
    if (!order || order.school_id !== schoolId) throw new NotFoundException('Order not found');
    if (order.status !== SeatOrderStatus.PENDING) {
      throw new ConflictException('This order is not waiting for payment.');
    }
    const started: PaymentState = { pay_started_at: new Date().toISOString() };
    // A Redis error here fails the start (no payment without somewhere to remember it).
    const won = await this.redis.set(
      PAYMENT_KEY(orderId),
      JSON.stringify(started),
      'EX',
      CREATING_TTL_SEC,
      'NX',
    );
    if (won !== 'OK') {
      // A payment is already live for this order: hand back its page, never make a second one.
      const live = await this.readState(orderId);
      if (live?.bkash_url) return { bkash_url: live.bkash_url };
      throw new ConflictException('A payment is already starting for this order.');
    }
    let created: BkashPayment;
    try {
      created = await this.client.create({
        amountPaisa: order.amount_paisa,
        orderId,
        callbackUrl: `${resolveAppBaseUrl(this.config)}/api/v1/billing/bkash/callback`,
        payerReference: schoolId,
      });
    } catch (err) {
      await this.redis.del(PAYMENT_KEY(orderId)).catch(() => undefined);
      this.logger.error(`bKash create failed for order ${orderId}: ${errMessage(err)}`);
      throw new ServiceUnavailableException('Online payment is not available right now.');
    }
    if (created.statusCode !== '0000' || !created.paymentID || !created.bkashURL) {
      // We won the NX lock, so no paymentID was ever stored for this order: closing it is safe.
      // (A stored paymentID means a payment may exist, and then the order must stay PENDING.)
      await this.redis.del(PAYMENT_KEY(orderId)).catch(() => undefined);
      await this.orders.markFailed(orderId);
      this.logger.error(`bKash create refused for order ${orderId}: code ${created.statusCode}`);
      throw new ServiceUnavailableException('Online payment is not available right now.');
    }
    await this.redis.set(
      PAYMENT_KEY(orderId),
      JSON.stringify({ ...started, paymentID: created.paymentID, bkash_url: created.bkashURL }),
      'EX',
      PAYMENT_TTL_SEC,
    );
    return { bkash_url: created.bkashURL };
  }

  /**
   * The browser came back from bKash. Nothing in the URL is trusted; it only names a payment.
   * Order of checks: ask bKash about the paymentID (query), find our order from bKash's own
   * invoice number, require that order to be PENDING and this paymentID to be the one we started,
   * and only then execute. Anything off throws a generic 400 (Rule 23) and changes nothing.
   */
  async handleCallback(
    paymentID: string,
    status: string,
  ): Promise<{ orderId: string; outcome: CallbackOutcome }> {
    const outcome: CallbackOutcome =
      status === 'success' ? 'success' : status === 'cancel' ? 'cancel' : 'failure';
    let known: BkashPayment;
    try {
      known = await this.client.query(paymentID);
    } catch (err) {
      this.logger.error(`bKash callback query failed: ${errMessage(err)}`);
      throw new BadRequestException('Payment not found');
    }
    const orderId = known.merchantInvoiceNumber;
    if (known.statusCode !== '0000' || !orderId || !isUUID(orderId)) {
      throw new BadRequestException('Payment not found');
    }
    const order = await this.orders.findForPayment(orderId);
    const state = await this.readState(orderId).catch((err) => {
      this.logger.error(`bKash callback could not read payment state: ${errMessage(err)}`);
      return undefined;
    });
    if (!order || state?.paymentID !== paymentID) {
      this.logger.error(`bKash callback paymentID does not match order ${orderId}`);
      throw new BadRequestException('Payment not found');
    }
    // A replay after PAID (or any non-PENDING order) shows the result and executes nothing.
    if (order.status !== SeatOrderStatus.PENDING) return { orderId, outcome };
    if (outcome === 'success') {
      const tx = await this.settle(paymentID, known);
      if (tx?.transactionStatus === 'Completed') await this.applyCompleted(tx);
    }
    return { orderId, outcome };
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

  /** Marks the order paid only when the completed transaction matches this order exactly. */
  private async applyCompleted(tx: BkashPayment): Promise<void> {
    const order = await this.orders.findForPayment(tx.merchantInvoiceNumber as string);
    const paid = bdtToPaisa(tx.amount);
    if (!order || !tx.trxID || tx.currency !== 'BDT' || paid !== BigInt(order.amount_paisa)) {
      this.logger.error(
        `bKash completed payment does not match order (order ${tx.merchantInvoiceNumber ?? '-'}, trx ${tx.trxID ?? '-'})`,
      );
      throw new BadRequestException('Payment not found');
    }
    // Idempotent: a replay finds the order PAID, records no second payment.
    const { applied } = await this.orders.markPaid(order.id, {
      method: PlatformPaymentMethod.BKASH,
      gateway_ref: tx.trxID,
      amount_paisa: order.amount_paisa,
      raw: {
        paymentID: tx.paymentID ?? null,
        trxID: tx.trxID,
        amount: tx.amount,
        currency: tx.currency,
        transactionStatus: tx.transactionStatus,
        merchantInvoiceNumber: tx.merchantInvoiceNumber,
      },
    });
    if (!applied) {
      // Callback and reconciler raced, or a payment completed for an order already settled.
      this.logger.error(
        `bKash payment completed but order ${order.id} was not PENDING (trx ${tx.trxID}): check for a double payment`,
      );
    }
  }

  /** Every 10 min: PENDING orders whose payment started in the last 24 h and never settled. */
  async reconcilePending(): Promise<number> {
    const rows: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM seat_orders WHERE status = $1 AND created_at > now() - interval '72 hours'`,
      [SeatOrderStatus.PENDING],
    );
    let paid = 0;
    for (const { id } of rows) {
      try {
        const state = await this.readState(id);
        if (!state?.paymentID) continue;
        if (Date.now() - Date.parse(state.pay_started_at) > RECONCILE_WINDOW_MS) continue;
        const tx = await this.client.query(state.paymentID);
        if (tx.transactionStatus === 'Completed' && tx.merchantInvoiceNumber === id) {
          await this.applyCompleted(tx);
          paid++;
        }
      } catch (err) {
        this.logger.warn(`bKash reconcile skipped order ${id}: ${errMessage(err)}`);
      }
    }
    return paid;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
