import type { APIRequestContext } from '@playwright/test';

import { expect } from '../fixtures/test';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS, type SeedRole } from '../seed-contract';

/**
 * [8.10.7.6.06] Helpers for `dashboard-reconciliation.spec.ts`: log in as any seed
 * role over HTTP, read a widget and its source page endpoint, and compare the two
 * with a message that prints both numbers and both URLs.
 */

interface Session {
  token: string;
  tenantId: string;
}

// One password login per role per worker. Logging in writes an audit row, so doing it
// up front (and only once) keeps the `recent-activity` comparison stable.
const sessions = new Map<SeedRole, Session>();

export async function roleSession(request: APIRequestContext, role: SeedRole): Promise<Session> {
  const cached = sessions.get(role);
  if (cached) return cached;
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const response = await request.post('/api/v1/auth/login', {
    data: { email: SEED_ROLE_EMAILS[role], password },
  });
  if (!response.ok()) throw new Error(`${role} login failed: ${response.status()}`);
  const body = (await response.json()) as {
    access_token: string;
    memberships: { tenantId: string; role: string }[];
  };
  const membership = body.memberships.find((m) => m.role === role.toUpperCase());
  if (!membership) throw new Error(`no ${role} membership`);
  const session = { token: body.access_token, tenantId: membership.tenantId };
  sessions.set(role, session);
  return session;
}

export async function getJson<T>(
  request: APIRequestContext,
  role: SeedRole,
  path: string,
): Promise<T> {
  const session = await roleSession(request, role);
  const response = await request.get(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
  });
  if (!response.ok()) {
    throw new Error(`GET ${path} as ${role} failed: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export const widget = <T>(request: APIRequestContext, role: SeedRole, key: string) =>
  getJson<T>(request, role, `/dashboard/widgets/${key}`);

/** Rows of a list response: a bare array or `{ data: [...] }`. */
export const rowsOf = <T>(body: T[] | { data: T[] }): T[] =>
  Array.isArray(body) ? body : body.data;

/** Total of a paged list response, whichever of the two shapes the endpoint uses. */
export const totalOf = (body: { total?: number; meta?: { total?: number } }): number => {
  const total = body.total ?? body.meta?.total;
  if (total === undefined) throw new Error(`no total in ${JSON.stringify(body).slice(0, 200)}`);
  return total;
};

/** Σ `field` over every page of a paged list (`data` rows, `totalPages`). */
export async function sumAllPages(
  request: APIRequestContext,
  role: SeedRole,
  path: string,
  field: string,
  limit = 100,
): Promise<number> {
  const sep = path.includes('?') ? '&' : '?';
  let sum = 0;
  for (let page = 1; ; page++) {
    const body = await getJson<{ data: Record<string, number>[]; totalPages?: number }>(
      request,
      role,
      `${path}${sep}page=${page}&limit=${limit}`,
    );
    sum += body.data.reduce((n, row) => n + Number(row[field] ?? 0), 0);
    if (page >= (body.totalPages ?? 1)) return sum;
  }
}

/** Every row of a paged list (`data`, `totalPages`). */
export async function allPages<T>(
  request: APIRequestContext,
  role: SeedRole,
  path: string,
  limit = 100,
): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?';
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const body = await getJson<{ data: T[]; totalPages?: number }>(
      request,
      role,
      `${path}${sep}page=${page}&limit=${limit}`,
    );
    out.push(...body.data);
    if (page >= (body.totalPages ?? 1)) return out;
  }
}

/** The school's calendar day, the way the server computes it (Asia/Dhaka). */
export const dhakaDay = (at: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(at);

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * `expect(widgetValue).toEqual(sourceValue)` whose failure message names both
 * values and both URLs, so a mismatch is readable straight from the CI log.
 */
export function expectSame(
  label: string,
  widgetValue: unknown,
  widgetUrl: string,
  sourceValue: unknown,
  sourceUrl: string,
): void {
  expect(
    widgetValue,
    `${label}: widget ${JSON.stringify(widgetValue)} (${widgetUrl}) != source ${JSON.stringify(sourceValue)} (${sourceUrl})`,
  ).toEqual(sourceValue);
}

/** Read-only count on the e2e database, for a source that has no list endpoint. */
export async function dbCount(sql: string, params: unknown[]): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // `pg` is hoisted from the server and has no types here (same trick as `e2e/api.ts`).
  const { Client } = (await import('pg' as string)) as {
    Client: new (options: { connectionString: string }) => {
      connect(): Promise<void>;
      query(sql: string, params: unknown[]): Promise<{ rows: { n: string }[] }>;
      end(): Promise<void>;
    };
  };
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return Number((await client.query(sql, params)).rows[0]?.n ?? 0);
  } finally {
    await client.end();
  }
}
