import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';

import { platformApiSession, post } from '../api';
import { shells } from '../config';

interface PgClient {
  connect(): Promise<void>;
  query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

/** One short-lived connection per call (the test database); `pg` ships no types. */
async function sql(text: string, args: unknown[] = []): Promise<Record<string, unknown>[]> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const { Client } = require('pg') as { Client: new (o: object) => PgClient };
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, args)).rows;
  } finally {
    await client.end();
  }
}

/**
 * [100.6.02] An active SMS package of the spec's own. A package needs a step-up token through
 * the API, which these school journeys are not about, so the row goes in directly. The name
 * carries a timestamp: the catalog is shared by every worker.
 */
export async function insertSmsPackage(
  label: string,
  smsCount: number,
  pricePaisa: number,
): Promise<{ id: string; name: string }> {
  const name = `${label} ${crypto.randomUUID().slice(0, 8)}`;
  const [row] = await sql(
    `INSERT INTO sms_bundle_catalog (name, sms_count, validity_days, price_paisa, active)
     VALUES ($1, $2, 30, $3, true) RETURNING id`,
    [name, smsCount, pricePaisa],
  );
  return { id: row!['id'] as string, name };
}

/** Takes a spec's package off sale again: the catalog is shared by every worker and spec. */
export async function deactivateSmsPackages(...ids: string[]): Promise<void> {
  await sql(`UPDATE sms_bundle_catalog SET active = false WHERE id = ANY($1::uuid[])`, [ids]);
}

/** The owner records the money for an order (the same `markPaid` the bKash callback runs). */
export async function ownerRecordsPayment(
  playwright: PlaywrightWorkerArgs['playwright'],
  kind: 'orders' | 'sms-bundle-orders',
  orderId: string,
): Promise<void> {
  // Its own context: the cockpit login must not replace a school admin's cookie jar.
  const owner: APIRequestContext = await playwright.request.newContext({
    baseURL: shells.app.baseURL,
  });
  try {
    const session = await platformApiSession(owner);
    await post(owner, session, `/platform/billing/${kind}/${orderId}/offline-payment`, {
      method: 'OFFLINE_CASH',
      reference: `E2E${crypto.randomUUID().slice(0, 8)}`,
      idempotency_key: `e2e-${crypto.randomUUID()}`,
    });
  } finally {
    await owner.dispose();
  }
}

export const ownerPaysPackageOrder = (
  playwright: PlaywrightWorkerArgs['playwright'],
  orderId: string,
) => ownerRecordsPayment(playwright, 'sms-bundle-orders', orderId);
