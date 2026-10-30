import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { expect, test, type APIRequestContext } from '@playwright/test';

import { uniqueRegistration } from '../api';
import { t } from '../i18n';
import { RegisterPage } from '../pages';

/**
 * [88.1.05] Epic 88 wave 1, end to end. Runs only in the opt-in `demo` project, against a
 * DEMO_MODE server with `MESSAGE_SINK=mailpit` and a reachable Mailpit (`MAILPIT_URL`, default
 * http://localhost:8025). Register and the OTP are open in the demo (D3, U6): the code is never
 * echoed in the response, so the spec reads it from the inbox like a visitor would.
 * Forgot / reset password and social link / unlink stay closed (88.1.02 review).
 */
const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const PASSWORD = 'Demo-Visitor-9x!';
/** Written by the signup test; read by the after-reset test (see the last test). */
const VISITOR_FILE = 'e2e/.demo-visitor.json';

/** The OTP SMS lands in Mailpit as an email to `<phone>@sms.sink.invalid` (MailpitSinkProvider). */
async function otpFromInbox(request: APIRequestContext, phone: string): Promise<string> {
  let code = '';
  await expect(async () => {
    const found = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${phone}@sms.sink.invalid"`)}`,
    );
    expect(found.ok()).toBe(true);
    const { messages } = (await found.json()) as { messages: { ID: string }[] };
    expect(messages.length).toBeGreaterThan(0);
    const msg = await request.get(`${MAILPIT}/api/v1/message/${messages[0].ID}`);
    const match = /\b(\d{6})\b/.exec(((await msg.json()) as { Text: string }).Text);
    expect(match).not.toBeNull();
    code = match![1];
  }).toPass({ timeout: 15_000 });
  return code;
}

test('a visitor signs up with a made-up phone, reads the OTP from the inbox, and gets a school', async ({
  page,
  request,
}) => {
  const who = uniqueRegistration();
  const register = new RegisterPage(page);
  await register.goto();

  // Not submitDetails(): the demo never echoes the code (no `debug.otp`).
  await page.getByLabel(t('register.fields.adminName')).fill(who.adminName);
  await page.getByLabel(t('register.fields.phone')).fill(who.phone);
  await page.getByLabel(t('register.fields.email')).fill(who.email);
  await page.getByLabel(t('register.fields.schoolName')).fill(who.schoolName);
  await page.getByLabel(t('register.fields.address')).fill('1 Demo Road, Dhaka');
  await page.getByRole('checkbox', { name: t('register.terms') }).check();
  await page.getByRole('button', { name: t('register.continue') }).click();
  await register.submitCode(await otpFromInbox(request, who.phone));
  await register.setPassword(PASSWORD);

  await expect(page).toHaveURL(/\/(welcome|dashboard)/, { timeout: 15_000 });
  mkdirSync(dirname(VISITOR_FILE), { recursive: true });
  writeFileSync(VISITOR_FILE, JSON.stringify({ email: who.email, password: PASSWORD }));
});

test('a 101-row student file is refused whole with DEMO_ROW_LIMIT', async ({ request }) => {
  const who = uniqueRegistration();
  const started = await request.post('/api/v1/auth/register/start', {
    data: {
      admin_name: who.adminName,
      school_name: who.schoolName,
      country_code: 'BD',
      address: '1 Demo Road, Dhaka',
      phone: who.phone,
      email: who.email,
      terms_accepted: true,
      captcha_token: 'no-captcha',
    },
  });
  expect(started.ok()).toBe(true);
  const { registration_id, debug } = (await started.json()) as {
    registration_id: string;
    debug?: unknown;
  };
  expect(debug).toBeUndefined();
  const verified = await request.post('/api/v1/auth/register/verify', {
    data: { registration_id, otp: await otpFromInbox(request, who.phone) },
  });
  expect(verified.ok()).toBe(true);
  const body = (await verified.json()) as {
    access_token: string;
    memberships: { tenantId: string; role: string }[];
  };
  const tenantId = body.memberships.find((m) => m.role === 'ADMIN')!.tenantId;

  const header =
    'student_name,class,section,roll,registration_number,guardian1_name,guardian1_phone,' +
    'guardian1_email,guardian2_name,guardian2_phone,guardian2_email,home_address,preferred_communication';
  const rows = Array.from(
    { length: 101 },
    (_, i) => `Kid ${i + 1},Class 1,A,${i + 1},,Parent ${i + 1},+88017${30000000 + i},,,,,,SMS`,
  );
  const res = await request.post('/api/v1/students/bulk-upload/validate', {
    headers: { Authorization: `Bearer ${body.access_token}`, 'X-Tenant-ID': tenantId },
    multipart: {
      file: {
        name: 'students.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from([header, ...rows].join('\n')),
      },
    },
  });
  expect(res.status()).toBe(422);
  const err = (await res.json()) as { message: string; details: unknown };
  expect(err.message).toBe('Demo: at most 100 rows per request');
  expect(err.details).toEqual({ code: 'DEMO_ROW_LIMIT', limit: 100, count: 101 });
});

// 88.1.02 review: these four stay closed (the reset link would land in the public inbox, and
// social linking would attach a visitor's real account to a shared card). Register, OTP and
// mobile login are open, which the two tests above prove.
for (const [method, path] of [
  ['POST', '/api/v1/auth/forgot-password'],
  ['POST', '/api/v1/auth/reset-password'],
  ['POST', '/api/v1/auth/social/google/link-start'],
  ['DELETE', '/api/v1/auth/social/identities/google'],
] as const) {
  test(`${method} ${path} still answers 403 DEMO_DISABLED`, async ({ request }) => {
    const res = await request.fetch(path, { method, data: {} });
    expect(res.status()).toBe(403);
    const json = (await res.json()) as {
      details?: { code?: string };
      message?: { details?: { code?: string } };
    };
    expect(json.details?.code ?? json.message?.details?.code).toBe('DEMO_DISABLED');
  });
}

// The reset rebuilds the whole database (scripts/demo/reset.sh), so the visitor school goes with
// it. Run the reset between two runs: `E2E_DEMO_AFTER_RESET=1` then checks the visitor is gone.
test('after the reset the visitor school is gone', async ({ request }) => {
  test.skip(process.env.E2E_DEMO_AFTER_RESET !== '1', 'set E2E_DEMO_AFTER_RESET=1 after a reset');
  const visitor = JSON.parse(readFileSync(VISITOR_FILE, 'utf8')) as {
    email: string;
    password: string;
  };
  const res = await request.post('/api/v1/auth/login', { data: visitor });
  expect(res.status()).toBe(401);
});
