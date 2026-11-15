import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

const { assertSafe, fetchJson } = vi.hoisted(() => ({
  assertSafe: vi.fn(),
  fetchJson: vi.fn(),
}));
vi.mock('../../communications/providers/shared/outbound-destination-guard', () => ({
  assertSafeHttpDestination: assertSafe,
}));
vi.mock('../../communications/providers/shared/pinned-http', () => ({
  fetchPinnedJson: fetchJson,
}));

import { BkashClient, bdtToPaisa, paisaToBdt } from './bkash.client';

const ENV: Record<string, string> = {
  BKASH_BASE_URL: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/',
  BKASH_APP_KEY: 'key',
  BKASH_APP_SECRET: 'secret',
  BKASH_USERNAME: 'user',
  BKASH_PASSWORD: 'pass',
};

function build(redis: Partial<Record<'get' | 'set' | 'del', ReturnType<typeof vi.fn>>> = {}) {
  const r = {
    del: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    ...redis,
  };
  const client = new BkashClient(
    { get: (k: string) => ENV[k] } as unknown as ConfigService,
    r as unknown as Redis,
  );
  return { client, redis: r };
}

beforeEach(() => {
  assertSafe.mockReset().mockResolvedValue({ url: new URL(ENV.BKASH_BASE_URL), addresses: [] });
  fetchJson.mockReset();
});

describe('paisaToBdt', () => {
  it('formats integer paisa as a BDT string with 2 decimals', () => {
    expect(paisaToBdt(300000)).toBe('3000.00');
    expect(paisaToBdt('12345')).toBe('123.45');
    expect(paisaToBdt(5)).toBe('0.05');
  });
});

describe('bdtToPaisa', () => {
  it('parses digits with up to 2 decimals and rejects anything else', () => {
    expect(bdtToPaisa('3000.00')).toBe(300000n);
    expect(bdtToPaisa('12.5')).toBe(1250n);
    expect(bdtToPaisa('7')).toBe(700n);
    for (const bad of ['1e3', '-1', '1.234', '', '1,000', undefined, 12]) {
      expect(bdtToPaisa(bad)).toBeUndefined();
    }
  });
});

describe('BkashClient', () => {
  it('a business refusal (has a statusCode) keeps the cached token and is not retried', async () => {
    fetchJson.mockResolvedValueOnce({ statusCode: '2023' });
    const { client, redis } = build();
    redis.get.mockResolvedValue('tok');
    expect((await client.query('P')).statusCode).toBe('2023');
    expect(redis.del).not.toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('an answer without a statusCode drops the cached token and retries once with a fresh grant', async () => {
    fetchJson
      .mockResolvedValueOnce({ message: 'Unauthorized' }) // stale cached token
      .mockResolvedValueOnce({ id_token: 'fresh' })
      .mockResolvedValueOnce({ statusCode: '0000' });
    const { client, redis } = build();
    redis.get.mockResolvedValue('stale');
    expect((await client.query('P')).statusCode).toBe('0000');
    expect(redis.del).toHaveBeenCalledWith('bkash:token');
    expect(fetchJson.mock.calls[2][2].headers.authorization).toBe('fresh');
    // Every request carries a timeout signal.
    expect(fetchJson.mock.calls[0][2].signal).toBeDefined();
  });

  it('pins the host: every call is checked by the SSRF guard and sent through the pinned fetch', async () => {
    fetchJson
      .mockResolvedValueOnce({ id_token: 'tok' })
      .mockResolvedValueOnce({ statusCode: '0000' });
    const { client } = build();
    await client.query('PAY1');
    expect(assertSafe).toHaveBeenCalledTimes(2); // grant + query
    // Trailing slash trimmed, no double slash in the path.
    expect(fetchJson.mock.calls[1][1]).toBe(
      'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout/payment/status',
    );
  });

  it('refuses to call out when the guard rejects the destination', async () => {
    assertSafe.mockRejectedValueOnce(new Error('blocked'));
    const { client } = build();
    await expect(client.token()).rejects.toThrow('blocked');
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('caches the token in Redis for 50 minutes and reuses it', async () => {
    fetchJson.mockResolvedValueOnce({ id_token: 'tok' });
    const { client, redis } = build();
    expect(await client.token()).toBe('tok');
    expect(redis.set).toHaveBeenCalledWith('bkash:token', 'tok', 'EX', 3000);
    redis.get.mockResolvedValue('tok');
    expect(await client.token()).toBe('tok');
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('falls back to a fresh grant when Redis is down', async () => {
    fetchJson.mockResolvedValueOnce({ id_token: 'fresh' });
    const { client } = build({
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
    });
    expect(await client.token()).toBe('fresh');
  });

  it('create sends the amount as a 2-decimal BDT string and the order id as the invoice number', async () => {
    fetchJson
      .mockResolvedValueOnce({ id_token: 'tok' })
      .mockResolvedValueOnce({ statusCode: '0000', paymentID: 'P' });
    const { client } = build();
    await client.create({
      amountPaisa: '300000',
      orderId: 'ord-1',
      callbackUrl: 'https://app/cb',
      payerReference: 'school-1',
    });
    const [, , init] = fetchJson.mock.calls[1];
    expect(JSON.parse(init.body)).toMatchObject({
      amount: '3000.00',
      currency: 'BDT',
      merchantInvoiceNumber: 'ord-1',
      callbackURL: 'https://app/cb',
    });
    expect(init.headers.authorization).toBe('tok');
  });

  describe('tenant credentials', () => {
    const tenant = (id: string) => ({
      environment: 'SANDBOX',
      appKey: 'k-' + id,
      appSecret: 'SECRET-' + id,
      username: 'u-' + id,
      password: 'PW-' + id,
      tenantId: id,
    });

    it('two tenants get two tokens, each cached under its own key', async () => {
      fetchJson
        .mockResolvedValueOnce({ id_token: 'tokA' })
        .mockResolvedValueOnce({ id_token: 'tokB' });
      const { client, redis } = build();
      expect(await client.token(false, tenant('A'))).toBe('tokA');
      expect(await client.token(false, tenant('B'))).toBe('tokB');
      expect(redis.set).toHaveBeenCalledWith('bkash:token:A:SANDBOX', 'tokA', 'EX', 3000);
      expect(redis.set).toHaveBeenCalledWith('bkash:token:B:SANDBOX', 'tokB', 'EX', 3000);
      // Tenant A's grant used A's own creds, not env creds.
      expect(JSON.parse(fetchJson.mock.calls[0][2].body)).toEqual({
        app_key: 'k-A',
        app_secret: 'SECRET-A',
      });
    });

    it('reads the cache by tenant key, never the env key', async () => {
      const { client, redis } = build();
      redis.get.mockImplementation(async (k: string) =>
        k === 'bkash:token:A:SANDBOX' ? 'cachedA' : null,
      );
      expect(await client.token(false, tenant('A'))).toBe('cachedA');
      expect(fetchJson).not.toHaveBeenCalled();
    });

    it('the host comes only from the fixed list, never from the creds', async () => {
      fetchJson.mockResolvedValueOnce({ id_token: 't' });
      const { client } = build();
      await client.token(false, { ...tenant('A'), baseUrl: 'https://evil.example' } as never);
      expect(fetchJson.mock.calls[0][1]).toBe(
        'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout/token/grant',
      );
      await expect(client.token(false, { ...tenant('A'), environment: 'EVIL' })).rejects.toThrow(
        'bKash environment is not valid',
      );
    });

    it('a tenant call without a valid environment never falls back to a caller baseUrl', async () => {
      const { client } = build();
      for (const environment of ['', undefined, 'sandbox', '__proto__', 'toString']) {
        await expect(
          client.token(false, {
            ...tenant('A'),
            environment,
            baseUrl: 'https://evil.example',
          } as never),
        ).rejects.toThrow('bKash environment is not valid');
      }
      expect(fetchJson).not.toHaveBeenCalled();
    });

    it('the cache key is built from tenantId + environment; a missing tenantId is refused', async () => {
      const { client, redis } = build();
      fetchJson.mockResolvedValue({ id_token: 't' });
      await client.token(false, { ...tenant('A'), cacheKey: 'bkash:token' } as never);
      await client.token(false, { ...tenant('A'), environment: 'PRODUCTION' });
      expect(redis.set).toHaveBeenCalledWith('bkash:token:A:SANDBOX', 't', 'EX', 3000);
      expect(redis.set).toHaveBeenCalledWith('bkash:token:A:PRODUCTION', 't', 'EX', 3000);
      await expect(client.token(false, { ...tenant(''), tenantId: '' })).rejects.toThrow(
        'bKash tenant is required',
      );
    });

    it('env path is unchanged: default creds use cache key bkash:token and the env host', async () => {
      fetchJson.mockResolvedValueOnce({ id_token: 'tok' });
      const { client, redis } = build();
      await client.token();
      expect(redis.set).toHaveBeenCalledWith('bkash:token', 'tok', 'EX', 3000);
      expect(fetchJson.mock.calls[0][1]).toContain('https://tokenized.sandbox.bka.sh/v1.2.0-beta/');
    });

    it('a failed grant, a Redis outage and a guard refusal never leak credentials', async () => {
      const logs: string[] = [];
      const spy = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation((m) => void logs.push(String(m)));
      fetchJson.mockResolvedValueOnce({ message: 'bad' }); // no id_token
      const { client } = build({ get: vi.fn().mockRejectedValue(new Error('down')) });
      let text = '';
      await client.testConnection(tenant('A')).catch((e: Error) => (text = e.message));
      assertSafe.mockRejectedValueOnce(new Error('blocked'));
      await client.testConnection(tenant('A')).catch((e: Error) => (text += e.message));
      spy.mockRestore();
      const all = text + logs.join(' ');
      for (const secret of ['SECRET-A', 'PW-A', 'k-A', 'u-A']) expect(all).not.toContain(secret);
      expect(text).toContain('bKash token grant failed');
    });
  });
});
