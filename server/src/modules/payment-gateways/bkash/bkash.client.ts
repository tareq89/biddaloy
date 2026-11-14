import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { OTP_REDIS } from '../../account-access/otp.service';
import { assertSafeHttpDestination } from '../../communications/providers/shared/outbound-destination-guard';
import { fetchPinnedJson } from '../../communications/providers/shared/pinned-http';
import type { PaymentGatewayEnvironment } from '@biddaloy/shared';
import type {
  CreatePaymentInput,
  GatewayCreds,
  GatewayPayment,
  PaymentGatewayProvider,
} from '../payment-gateway.provider';
import { BKASH_HOSTS } from './bkash-hosts';

const ENV_TOKEN_KEY = 'bkash:token';
/** bKash tokens live 1 hour; refresh a little early. */
const TOKEN_TTL_SEC = 50 * 60;

export type BkashPayment = GatewayPayment;

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
 * bKash tokenized checkout over the SSRF-guarded path (Rule 7). Billing uses operator env creds
 * (the default); a school passes its own. Every call goes through `assertSafeHttpDestination` +
 * `fetchPinnedJson`; the token is cached per `creds.cacheKey`. Creds are never logged.
 */
@Injectable()
export class BkashClient implements PaymentGatewayProvider {
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

  /** Billing's creds: operator env, cache key `bkash:token` (unchanged). */
  private envCreds(): GatewayCreds {
    return {
      baseUrl: this.env('BKASH_BASE_URL'),
      appKey: this.env('BKASH_APP_KEY'),
      appSecret: this.env('BKASH_APP_SECRET'),
      username: this.env('BKASH_USERNAME'),
      password: this.env('BKASH_PASSWORD'),
      cacheKey: ENV_TOKEN_KEY,
    };
  }

  private baseUrl(creds: GatewayCreds): string {
    // A tenant (environment set) reaches only a fixed host (D14); baseUrl is the operator-env path.
    const url = creds.environment
      ? BKASH_HOSTS[creds.environment as PaymentGatewayEnvironment]
      : creds.baseUrl;
    if (!url) throw new Error('bKash environment is not valid');
    return url.replace(/\/+$/, '');
  }

  private async post(
    creds: GatewayCreds,
    path: string,
    headers: Record<string, string>,
    body: object,
  ): Promise<Record<string, unknown>> {
    const base = this.baseUrl(creds);
    const destination = await assertSafeHttpDestination(base);
    return (await fetchPinnedJson(destination, `${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })) as Record<string, unknown>;
  }

  /** Cached in Redis ~50 min per cacheKey. A Redis error just means a fresh grant. */
  async token(force = false, creds: GatewayCreds = this.envCreds()): Promise<string> {
    try {
      if (force) await this.redis.del(creds.cacheKey);
      else {
        const cached = await this.redis.get(creds.cacheKey);
        if (cached) return cached;
      }
    } catch {
      this.logger.warn('bKash token cache unavailable; granting a fresh token');
    }
    const res = await this.post(
      creds,
      '/tokenized/checkout/token/grant',
      { username: creds.username, password: creds.password },
      { app_key: creds.appKey, app_secret: creds.appSecret },
    );
    const idToken = res.id_token;
    if (typeof idToken !== 'string' || !idToken) throw new Error('bKash token grant failed');
    try {
      await this.redis.set(creds.cacheKey, idToken, 'EX', TOKEN_TTL_SEC);
    } catch {
      // not cached; the next call grants again
    }
    return idToken;
  }

  /** Always a fresh grant: proves the creds work. Throws fixed text, never the creds. */
  async testConnection(creds: GatewayCreds): Promise<void> {
    await this.token(true, creds);
  }

  /** A non-0000 answer may mean a stale cached token: drop it and retry once with a fresh grant. */
  private async call(creds: GatewayCreds, path: string, body: object): Promise<BkashPayment> {
    const send = async (force: boolean) =>
      (await this.post(
        creds,
        `/tokenized/checkout/${path}`,
        { authorization: await this.token(force, creds), 'x-app-key': creds.appKey },
        body,
      )) as BkashPayment;
    const first = await send(false);
    // A business refusal carries a statusCode; only an answer without one is treated as an auth failure.
    return first.statusCode ? first : send(true);
  }

  create(input: CreatePaymentInput, creds: GatewayCreds = this.envCreds()): Promise<BkashPayment> {
    return this.call(creds, 'create', {
      mode: '0011',
      payerReference: input.payerReference,
      callbackURL: input.callbackUrl,
      amount: paisaToBdt(input.amountPaisa),
      currency: 'BDT',
      intent: 'sale',
      merchantInvoiceNumber: input.orderId,
    });
  }

  execute(paymentID: string, creds: GatewayCreds = this.envCreds()): Promise<BkashPayment> {
    return this.call(creds, 'execute', { paymentID });
  }

  query(paymentID: string, creds: GatewayCreds = this.envCreds()): Promise<BkashPayment> {
    return this.call(creds, 'payment/status', { paymentID });
  }
}
