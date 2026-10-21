import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { OTP_REDIS } from '../../account-access/otp.service';
import { assertSafeHttpDestination } from '../../communications/providers/shared/outbound-destination-guard';
import { fetchPinnedJson } from '../../communications/providers/shared/pinned-http';

const TOKEN_KEY = 'bkash:token';
/** bKash tokens live 1 hour; refresh a little early. */
const TOKEN_TTL_SEC = 50 * 60;

export interface BkashPayment {
  paymentID?: string;
  bkashURL?: string;
  trxID?: string;
  transactionStatus?: string;
  amount?: string;
  currency?: string;
  merchantInvoiceNumber?: string;
  statusCode?: string;
}

/** BDT string with 2 decimals from integer paisa, no floats: 12345 -> "123.45". */
export function paisaToBdt(paisa: number | string): string {
  const p = BigInt(paisa);
  return `${p / 100n}.${String(p % 100n).padStart(2, '0')}`;
}

/** "123.45" -> 12345n; anything that is not digits with up to 2 decimals is undefined. */
export function bdtToPaisa(bdt: unknown): bigint | undefined {
  if (typeof bdt !== 'string' || !/^\d+(\.\d{1,2})?$/.test(bdt)) return undefined;
  const [whole, frac = ''] = bdt.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

/**
 * bKash tokenized checkout over the SSRF-guarded path (Rule 7): the host comes from operator
 * config `BKASH_BASE_URL`, and every call still goes through `assertSafeHttpDestination` +
 * `fetchPinnedJson`. Sandbox vs production is just which base URL is set.
 */
@Injectable()
export class BkashClient {
  private readonly logger = new Logger(BkashClient.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(OTP_REDIS) private readonly redis: Redis,
  ) {}

  isConfigured(): boolean {
    return [
      'BKASH_BASE_URL',
      'BKASH_APP_KEY',
      'BKASH_APP_SECRET',
      'BKASH_USERNAME',
      'BKASH_PASSWORD',
    ].every((k) => !!this.config.get<string>(k));
  }

  private env(key: string): string {
    return this.config.get<string>(key) ?? '';
  }

  private async post(
    path: string,
    headers: Record<string, string>,
    body: object,
  ): Promise<Record<string, unknown>> {
    const base = this.env('BKASH_BASE_URL').replace(/\/+$/, '');
    const destination = await assertSafeHttpDestination(base);
    return (await fetchPinnedJson(destination, `${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })) as Record<string, unknown>;
  }

  /** Cached in Redis ~50 min. A Redis error just means a fresh grant (the callback must still work). */
  async token(force = false): Promise<string> {
    try {
      if (force) await this.redis.del(TOKEN_KEY);
      else {
        const cached = await this.redis.get(TOKEN_KEY);
        if (cached) return cached;
      }
    } catch {
      this.logger.warn('bKash token cache unavailable; granting a fresh token');
    }
    const res = await this.post(
      '/tokenized/checkout/token/grant',
      { username: this.env('BKASH_USERNAME'), password: this.env('BKASH_PASSWORD') },
      { app_key: this.env('BKASH_APP_KEY'), app_secret: this.env('BKASH_APP_SECRET') },
    );
    const idToken = res.id_token;
    if (typeof idToken !== 'string' || !idToken) throw new Error('bKash token grant failed');
    try {
      await this.redis.set(TOKEN_KEY, idToken, 'EX', TOKEN_TTL_SEC);
    } catch {
      // not cached; the next call grants again
    }
    return idToken;
  }

  /** A non-0000 answer may mean a stale cached token: drop it and retry once with a fresh grant. */
  private async call(path: string, body: object): Promise<BkashPayment> {
    const send = async (force: boolean) =>
      (await this.post(
        `/tokenized/checkout/${path}`,
        { authorization: await this.token(force), 'x-app-key': this.env('BKASH_APP_KEY') },
        body,
      )) as BkashPayment;
    const first = await send(false);
    // A business refusal carries a statusCode; only an answer without one is treated as an auth failure.
    return first.statusCode ? first : send(true);
  }

  create(input: {
    amountPaisa: number | string;
    orderId: string;
    callbackUrl: string;
    payerReference: string;
  }): Promise<BkashPayment> {
    return this.call('create', {
      mode: '0011',
      payerReference: input.payerReference,
      callbackURL: input.callbackUrl,
      amount: paisaToBdt(input.amountPaisa),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: input.orderId,
    });
  }

  execute(paymentID: string): Promise<BkashPayment> {
    return this.call('execute', { paymentID });
  }

  query(paymentID: string): Promise<BkashPayment> {
    return this.call('payment/status', { paymentID });
  }
}
