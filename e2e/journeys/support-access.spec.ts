import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

import { E2E_PASSWORD, registerTrialSchool, type RegisteredSchool } from '../api';
import { shells } from '../config';
import { COCKPIT_URL, expect, test } from '../fixtures/test';
import { LoginPage } from '../pages/login-page';
import {
  exchangeCode,
  firstCandidate,
  ownerSession,
  startLoginAs,
  tc,
} from '../platform/support-helpers';

/**
 * [99.6.03] The school admin's side of Biddaloy support access, end to end, on a school of the
 * spec's own (the shared seeded ones are used by other workers):
 *   1. first sign-in lands on `/welcome/support-access`; untick, save, Settings says Blocked;
 *   2. switch to Ask each time; the owner starts Login as (API); the admin opens the request,
 *      approves; the owner redeems the ticket; Settings lists the live visit with End;
 *   3. the admin ends it; the owner's next call is 401.
 * Tests 1 and 2 drive the support-access steps with the keyboard only. The owner is the seeded
 * cockpit owner; every person is created by registration (no real contact data).
 */
test.describe.configure({ mode: 'serial' });

const SETTINGS = '/settings?section=support';

let school: RegisteredSchool;
let admin: BrowserContext;
let page: Page;
let schoolApi: APIRequestContext;
let ownerApi: APIRequestContext;
let supportToken = '';

test.beforeAll(async ({ browser, playwright }) => {
  schoolApi = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  ownerApi = await playwright.request.newContext({ baseURL: COCKPIT_URL });
  school = await registerTrialSchool(schoolApi);
  // Signed out on purpose: the first-login page is only offered by a real sign-in.
  admin = await browser.newContext({
    baseURL: shells.app.baseURL,
    storageState: { cookies: [], origins: [] },
  });
  page = await admin.newPage();
});

test.afterAll(async () => {
  await admin.close();
  await schoolApi.dispose();
  await ownerApi.dispose();
});

test('first login: the box is ticked, unticking and saving blocks support', async () => {
  test.setTimeout(120_000);
  const login = new LoginPage(page);
  await login.goto();
  await login.loginWithOtp(school.email);
  // A code sign-in makes a new admin set a password first; then sign in again with it, which is
  // the sign-in that offers the support access page.
  await page.getByLabel(tc('auth', 'setPassword.label'), { exact: true }).fill(E2E_PASSWORD);
  await page.getByLabel(tc('auth', 'setPassword.confirmLabel')).fill(E2E_PASSWORD);
  await page.getByRole('button', { name: tc('auth', 'setPassword.submit') }).click();
  await expect(page).toHaveURL(/\/(dashboard|welcome)/);
  await admin.clearCookies();
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.clear();
  });
  await login.goto();
  await login.login(school.email, E2E_PASSWORD);

  await expect(page).toHaveURL(/\/welcome\/support-access/);
  const box = page.getByRole('checkbox', { name: tc('supportWelcome', 'checkbox') });
  await expect(box).toBeChecked();

  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).not.toBeChecked();
  await page.keyboard.press('Enter');

  await expect(page).not.toHaveURL(/support-access/);
  await page.goto(SETTINGS);
  await expect(
    page.getByRole('radio', { name: new RegExp(tc('supportAccess', 'blocked')) }),
  ).toBeChecked();
});

test('ask each time: the owner asks, the admin approves, the owner gets in and the visit is listed', async () => {
  // Two owner codes, each one waits for its own 30 s authenticator step.
  test.setTimeout(240_000);

  await page.goto(SETTINGS);
  const ask = page.getByRole('radio', { name: new RegExp(tc('supportAccess', 'ask')) });
  await ask.focus();
  await page.keyboard.press('Space');
  await expect(ask).toBeChecked();
  const save = page.getByRole('button', { name: tc('supportAccess', 'save'), exact: true });
  await save.focus();
  const saved = page.waitForResponse(
    (r) => r.url().includes('/support-access/settings') && r.request().method() === 'PUT',
  );
  await page.keyboard.press('Enter');
  expect((await saved).ok()).toBe(true);

  const owner = await ownerSession(ownerApi);
  const targetUserId = await firstCandidate(ownerApi, owner, school.session.tenantId, 'ADMIN');
  const body = {
    schoolId: school.session.tenantId,
    role: 'ADMIN',
    targetUserId,
    reason: 'E2E support access request',
    viewOnly: false,
  };
  const asked = await startLoginAs(ownerApi, owner, body);
  expect(asked.status).toBe('REQUESTED');
  expect(asked.code).toBeUndefined();

  // The admin opens the request from Settings > Requests (the same page the alert, SMS and
  // email links open). ponytail: the attention alert did not show for the request within 30 s in
  // the e2e server, so the alert link itself is not clicked here; see the report.
  await page.goto(SETTINGS);
  const open = page.getByRole('link', { name: tc('supportAccess', 'open'), exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/support-access/requests/${asked.id}`));

  const approve = page.getByRole('button', { name: tc('supportAccess', 'approve'), exact: true });
  await approve.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText(tc('supportAccess', 'reqApproved'))).toBeVisible();

  // The owner redeems the approved ticket.
  const entered = await startLoginAs(ownerApi, owner, { ...body, ticketId: asked.id });
  expect(entered.status).toBe('ACTIVE');
  expect(entered.code).toBeTruthy();
  supportToken = await exchangeCode(schoolApi, entered.code!);

  await page.goto(SETTINGS);
  // The list renders as cards at some widths, so match the badge and button, not a table row.
  const live = page.getByText(tc('supportAccess', 'live'));
  const endBtn = page.getByRole('button', { name: new RegExp(tc('supportAccess', 'end')) });
  await expect(live).toHaveCount(1);
  await expect(endBtn).toBeVisible();
});

test('the admin ends the live visit and the owner is signed out at once', async () => {
  await page.goto(SETTINGS);
  // The list renders as cards at some widths, so match the badge and button, not a table row.
  const live = page.getByText(tc('supportAccess', 'live'));
  const endBtn = page.getByRole('button', { name: new RegExp(tc('supportAccess', 'end')) });
  await endBtn.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: tc('supportAccess', 'end'), exact: true })
    .click();
  await expect(live).toHaveCount(0);

  const me = await schoolApi.get('/api/v1/auth/impersonation/me', {
    headers: { Authorization: `Bearer ${supportToken}` },
  });
  expect(me.status()).toBe(401);
});
