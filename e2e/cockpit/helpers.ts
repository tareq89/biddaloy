import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import * as bcrypt from 'bcrypt';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEV_COCKPIT_TOTP_SECRET } from '@biddaloy/shared';

import bnCockpit from '../../ui/src/i18n/locales/bn/cockpit.json';
import bnAuth from '../../ui/src/i18n/locales/bn/auth.json';
import bnApproval from '../../ui/src/i18n/locales/bn/approval.json';
import bnNav from '../../ui/src/i18n/locales/bn/nav.json';
import bnOwnerSecurity from '../../ui/src/i18n/locales/bn/ownerSecurity.json';
import bnPlatformOwners from '../../ui/src/i18n/locales/bn/platformOwners.json';
import { expectNoAxeViolations } from '../a11y/assert';
import { nextStepIn, totpNow } from '../totp';

/**
 * [98.4.99] Shared arrangement for the cockpit specs (project `cockpit`, see playwright.config.ts).
 * They need: a database seeded with SEED_COCKPIT_OWNER=true, a server with MESSAGE_SINK=mailpit
 * (the SMS and email codes and the reset link land in Mailpit), and the cockpit hostname.
 */
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const OWNER_PASSWORD = 'Owner-pass-12345-x';
export const DEV_OWNER_EMAIL = 'superadmin@biddaloy.test';

/** The bn catalogs (the default locale a fresh browser renders), looked up by dotted key. */
const catalogs = {
  auth: bnAuth,
  approval: bnApproval,
  nav: bnNav,
  cockpit: bnCockpit,
  ownerSecurity: bnOwnerSecurity,
  platformOwners: bnPlatformOwners,
};
export function tc(
  ns: keyof typeof catalogs,
  key: string,
  vars: Record<string, string> = {},
): string {
  // Some keys contain a dot themselves ("platform.owner_lock"): try the longest joined key first.
  const walk = (node: unknown, parts: string[]): unknown => {
    if (parts.length === 0) return node;
    if (typeof node !== 'object' || node === null) return undefined;
    for (let n = parts.length; n >= 1; n -= 1) {
      const head = parts.slice(0, n).join('.');
      if (head in node) return walk((node as Record<string, unknown>)[head], parts.slice(n));
    }
    return undefined;
  };
  const found = walk(catalogs[ns], key.split('.'));
  if (typeof found !== 'string') throw new Error(`missing i18n key ${ns}:${key}`);
  return found.replace(/\{\{(\w+)\}\}/g, (_, n: string) => vars[n] ?? '');
}

interface PgClient {
  connect(): Promise<void>;
  query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}
/** One short-lived connection per call; `pg` ships no types, so the surface used is declared above. */
async function sql(text: string, args: unknown[] = []): Promise<Record<string, unknown>[]> {
  const { Client } = require('pg') as { Client: new (o: object) => PgClient };
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, args)).rows;
  } finally {
    await client.end();
  }
}

export interface Owner {
  email: string;
  phone: string;
  password: string;
  /** Set once the authenticator is on (`enrolOwner`, or the seeded dev owner). */
  secret: string | undefined;
}

/** The seeded dev owner already has the public dev secret; it only lacks a phone for the device codes. */
export async function devOwner(): Promise<Owner> {
  const phone = `+88017${String(Date.now()).slice(-9)}`;
  await sql(
    `UPDATE users SET phone = COALESCE(phone, $2), phone_verified_at = COALESCE(phone_verified_at, now()),
     email_verified_at = COALESCE(email_verified_at, now()) WHERE email = $1`,
    [DEV_OWNER_EMAIL, phone],
  );
  const [row] = await sql(`SELECT phone FROM users WHERE email = $1`, [DEV_OWNER_EMAIL]);
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!row || !password) throw new Error('dev owner missing: seed with SEED_COCKPIT_OWNER=true');
  return {
    email: DEV_OWNER_EMAIL,
    phone: row.phone as string,
    password,
    secret: process.env.COCKPIT_TEST_TOTP_SECRET ?? DEV_COCKPIT_TOTP_SECRET,
  };
}

/** A new active owner with a password and contacts but no authenticator yet (first sign-in enrols). */
export async function newOwner(name = 'E2E Owner'): Promise<Owner> {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const email = `owner-${unique}@biddaloy.test`;
  const phone = `+88018${unique.slice(-9)}`;
  const [user] = await sql(
    `INSERT INTO users (email, phone, full_name, status, password_hash, email_verified_at, phone_verified_at)
     VALUES ($1, $2, $3, 'ACTIVE', $4, now(), now()) RETURNING id`,
    [email, phone, `${name} ${unique.slice(-4)}`, await bcrypt.hash(OWNER_PASSWORD, 12)],
  );
  await sql(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [user!.id]);
  return { email, phone, password: OWNER_PASSWORD, secret: undefined };
}

export async function fullNameOf(email: string): Promise<string> {
  const [row] = await sql(`SELECT full_name FROM users WHERE email = $1`, [email]);
  return row!.full_name as string;
}

/** Back to the two-owners-active starting point: unlock everyone, approvals on, no old requests. */
export async function resetOwnersState(): Promise<void> {
  await sql(`UPDATE users SET status = 'ACTIVE' WHERE id IN (SELECT user_id FROM platform_admins)`);
}

// A code works once per 30 s step (the server keeps the last step used per owner), so a second
// code in the same step waits for the next one. The last step is kept in a file: Playwright starts
// a new worker after a failed test, and an in-memory map would forget the step the old one used.
const STEP_FILE = join(tmpdir(), 'cockpit-e2e-last-totp-step.json');
function readSteps(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(STEP_FILE, 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}
export async function freshTotp(secret: string): Promise<string> {
  const steps = readSteps();
  if (steps[secret] === Math.floor(Date.now() / 30_000)) {
    await new Promise((r) => setTimeout(r, nextStepIn() + 300));
  }
  writeFileSync(
    STEP_FILE,
    JSON.stringify({ ...readSteps(), [secret]: Math.floor(Date.now() / 30_000) }),
  );
  return totpNow(secret);
}

export async function clearInbox(request: APIRequestContext, to: string): Promise<void> {
  await request.delete(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
}

/** The newest message sent to `to` (an address, or `<phone>@sms.sink.invalid` for an SMS). */
async function newestMessageText(request: APIRequestContext, to: string): Promise<string> {
  let text = '';
  await expect(async () => {
    const found = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    const { messages } = (await found.json()) as { messages: { ID: string }[] };
    expect(messages.length).toBeGreaterThan(0);
    const msg = await request.get(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`);
    text = ((await msg.json()) as { Text: string }).Text;
  }).toPass({ timeout: 40_000 });
  return text;
}

export async function smsCode(request: APIRequestContext, owner: Owner): Promise<string> {
  const text = await newestMessageText(request, `${owner.phone}@sms.sink.invalid`);
  return /\b(\d{6})\b/.exec(text)![1]!;
}
export async function emailCode(request: APIRequestContext, owner: Owner): Promise<string> {
  const text = await newestMessageText(request, owner.email);
  return /\b(\d{6})\b/.exec(text)![1]!;
}
export async function resetToken(request: APIRequestContext, owner: Owner): Promise<string> {
  const text = await newestMessageText(request, owner.email);
  return decodeURIComponent(/token=([^\s&"<>]+)/.exec(text)![1]!);
}
/** Both device codes are sent before the page shows the step: wipe the old ones first. */
export async function clearCodes(request: APIRequestContext, owner: Owner): Promise<void> {
  await clearOtpLimits();
  await clearInbox(request, owner.email);
  await clearInbox(request, `${owner.phone}@sms.sink.invalid`);
}

/** Password, authenticator, device codes over the API; the session cookie stays in `request`. */
export async function apiSignIn(request: APIRequestContext, owner: Owner): Promise<string> {
  await clearCodes(request, owner);
  const login = await request.post('/api/v1/auth/cockpit/login', {
    data: { email: owner.email, password: owner.password },
  });
  expect(login.ok()).toBe(true);
  const mfa = await request.post('/api/v1/auth/cockpit/mfa', {
    data: { mfaToken: (await login.json()).mfaToken, code: await freshTotp(owner.secret!) },
  });
  expect(mfa.ok()).toBe(true);
  const next = await mfa.json();
  if (next.step === 'done') return next.access_token as string;
  const done = await request.post('/api/v1/auth/cockpit/device-otp', {
    data: {
      deviceToken: next.deviceToken,
      smsCode: await smsCode(request, owner),
      emailCode: await emailCode(request, owner),
      rememberDevice: true,
    },
  });
  expect(done.ok()).toBe(true);
  return (await done.json()).access_token as string;
}

/**
 * `fill` that survives the dev server remounting the field once after the route chunk loads
 * (a value typed during the remount is lost): retries until the value sticks.
 */
export async function fillStable(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    // Code fields group their digits (spaces, dashes): compare the characters only.
    expect((await field.inputValue()).replace(/[\s-]/g, '')).toBe(value.replace(/[\s-]/g, ''));
  }).toPass({ timeout: 10_000 });
}

/**
 * Code requests have a 60 s cooldown and an hourly cap per destination. A rerun (or two sign-ins of
 * one owner in a minute) would get no code, so the run's own Redis db is cleared of both first.
 */
async function clearOtpLimits(): Promise<void> {
  const Redis = require('ioredis') as new (url: string) => {
    keys(p: string): Promise<string[]>;
    del(...k: string[]): Promise<number>;
    quit(): Promise<unknown>;
  };
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0');
  try {
    const keys = [...(await redis.keys('otp-cooldown:*')), ...(await redis.keys('otp-cap:*'))];
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    await redis.quit();
  }
}

export const test = base;
export { expect };

/** Turns the two-owner approval rule on or off directly (the UI switch itself needs the other owner). */
export async function setApprovals(enabled: boolean): Promise<void> {
  await sql(
    `INSERT INTO platform_settings (key, value) VALUES ('approvals.enabled', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(enabled)],
  );
}

/** Clears all requests and unlocks everyone: each run starts from "two active owners, approvals on". */
export async function resetOwners(): Promise<void> {
  // Owners the specs created earlier (rows are never deleted by the app, D10; this is the test database).
  await sql(
    `DELETE FROM platform_admins WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'owner-%@biddaloy.test')`,
  );
  await sql(`UPDATE users SET status = 'ACTIVE' WHERE id IN (SELECT user_id FROM platform_admins)`);
  await sql(`UPDATE platform_admins SET locked_by = NULL, locked_at = NULL`);
  await sql(`DELETE FROM platform_approvals`);
  await setApprovals(true);
}

/**
 * Enrols a new owner over the API (password, SMS and email codes, authenticator, recovery codes),
 * leaving `owner.secret` set and a remembered device in `request`'s cookies.
 */
export async function apiEnrol(request: APIRequestContext, owner: Owner): Promise<void> {
  await clearCodes(request, owner);
  const login = await request.post('/api/v1/auth/cockpit/login', {
    data: { email: owner.email, password: owner.password },
  });
  expect(login.ok(), `login ${login.status()} ${await login.text()}`).toBe(true);
  const { enrolToken } = await login.json();
  expect(enrolToken, 'owner has no authenticator yet').toBeTruthy();
  const start = await request.post('/api/v1/auth/cockpit/enrol/start', {
    data: {
      enrolToken,
      smsCode: await smsCode(request, owner),
      emailCode: await emailCode(request, owner),
    },
  });
  expect(start.ok()).toBe(true);
  owner.secret = (await start.json()).secret as string;
  const confirm = await request.post('/api/v1/auth/cockpit/enrol/confirm', {
    data: { enrolToken, code: await freshTotp(owner.secret), rememberDevice: true },
  });
  expect(confirm.ok()).toBe(true);
}

/**
 * Visits the pages once before the tests so the dev server has built their chunks: its first build
 * of a route can reload the page under a running test (a blank page, a lost keystroke).
 */
export async function warmUp(browser: Browser, paths: string[]): Promise<void> {
  const { baseURL } = test.info().project.use;
  const context = await browser.newContext({ baseURL: baseURL! });
  const page = await context.newPage();
  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await context.close();
}

/** The WCAG scan the school sweeps use, plus "the page does not scroll sideways" (reflow). */
export async function expectAccessiblePage(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expectNoAxeViolations(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
}
