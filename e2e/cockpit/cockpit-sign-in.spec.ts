import type { Browser, Page } from '@playwright/test';

import {
  expect,
  test,
  expectAccessiblePage,
  stubLegacyPlatformRoutes,
  warmUp,
  clearCodes,
  emailCode,
  freshTotp,
  newOwner,
  resetToken,
  smsCode,
  tc,
  clearInbox,
  fillStable,
  type Owner,
} from './helpers';

/**
 * [98.4.99] The owner sign-in journey on the cockpit host, end to end: forgot and reset password,
 * first sign-in (both codes), the two-step wizard, recovery codes, sign out, sign in with the
 * authenticator, the new-device check, and a recovery code. One new owner carries the whole run, so
 * the specs are serial. Runs on desktop and on a 390 px viewport (the `cockpit-phone` project).
 */
// A TOTP code works once per 30 s step, so a flow with several codes waits for steps.
test.describe.configure({ mode: 'serial', timeout: 180_000 });

const NEW_PASSWORD = 'Brand-new-pass-77!x';
let owner: Owner;
let recoveryCode = '';

async function passwordStep(page: Page, password: string) {
  await page.goto('/sign-in');
  await page.waitForLoadState('networkidle');
  await fillStable(page.getByLabel(tc('cockpit', 'signIn.identifierLabel')), owner.email);
  await fillStable(
    page.getByLabel(tc('cockpit', 'signIn.passwordLabel'), { exact: true }),
    password,
  );
  await page.getByRole('button', { name: tc('cockpit', 'signIn.next') }).click();
}

async function typeCode(page: Page, label: string, code: string) {
  await fillStable(page.getByLabel(label).first(), code);
}

/** A browser profile of its own: its own cookies, so its own "device". */
async function newDevice(browser: Browser): Promise<Page> {
  const { baseURL, viewport, hasTouch } = test.info().project.use;
  const context = await browser.newContext({
    baseURL: baseURL!,
    viewport: viewport ?? null,
    hasTouch: hasTouch ?? false,
  });
  await stubLegacyPlatformRoutes(context);
  return context.newPage();
}

// The owner's own device: first sign-in remembers it, so the second sign-in skips the device codes.
let myDevice: Page;

test.beforeAll(async ({ browser }) => {
  await warmUp(browser, [
    '/sign-in',
    '/sign-in/forgot',
    '/sign-in/reset',
    '/owner-security/two-step',
  ]);
  owner = await newOwner('Sign-in Owner');
  myDevice = await newDevice(browser);
});

test.afterAll(async () => {
  await myDevice.context().close();
});

test('forgot password then reset password', async ({ page, request }) => {
  await clearInbox(request, owner.email);
  await page.goto('/sign-in');
  await page.getByRole('link', { name: tc('cockpit', 'signIn.forgot') }).click();
  await page.waitForLoadState('networkidle');
  await fillStable(page.getByLabel(tc('cockpit', 'forgot.emailLabel')), owner.email);
  await page.getByRole('button', { name: tc('cockpit', 'forgot.send') }).click();
  await expect(page.getByText(tc('cockpit', 'forgot.sent'))).toBeVisible();

  const token = await resetToken(request, owner);
  await page.goto(`/sign-in/reset?token=${encodeURIComponent(token)}`);
  // The link secret leaves the address bar at once (Rule 13).
  await expect(page).not.toHaveURL(/token=/);
  await fillStable(page.getByLabel(tc('auth', 'setPassword.label'), { exact: true }), NEW_PASSWORD);
  await fillStable(page.getByLabel(tc('auth', 'setPassword.confirmLabel')), NEW_PASSWORD);
  await page.getByRole('button', { name: tc('cockpit', 'reset.submit') }).click();
  await expect(page).toHaveURL(/\/sign-in\?reset=/);
  await expect(page.getByText(tc('cockpit', 'signIn.passwordSaved'))).toBeVisible();
  owner.password = NEW_PASSWORD;
});

test('first sign-in: both codes, the wizard, recovery codes, sign out', async ({ request }) => {
  const page = myDevice;
  await clearCodes(request, owner);
  await passwordStep(page, owner.password);
  await expect(
    page.getByRole('heading', { name: tc('cockpit', 'signIn.enrol.title') }),
  ).toBeVisible();
  await typeCode(page, tc('cockpit', 'signIn.device.smsLabel'), await smsCode(request, owner));
  await typeCode(page, tc('cockpit', 'signIn.device.emailLabel'), await emailCode(request, owner));
  await page.getByRole('button', { name: tc('cockpit', 'signIn.signIn') }).click();

  // Wizard: add the authenticator with the key the page shows.
  await expect(page).toHaveURL(/\/owner-security\/two-step/);
  const key = (await page
    .locator('code, [data-testid="manual-key"]')
    .filter({ hasText: /^[A-Z2-7]{16,}$/ })
    .first()
    .textContent())!.trim();
  owner.secret = key;
  await typeCode(page, tc('ownerSecurity', 'wizard.codeLabel'), await freshTotp(key));
  await page.getByRole('button', { name: tc('ownerSecurity', 'wizard.next') }).click();

  // Recovery codes: shown once; Finish waits for the tick.
  await expect(page.getByText(tc('ownerSecurity', 'recoveryCodes.title'))).toBeVisible();
  recoveryCode = ((await page.locator('li[dir="ltr"]').first().textContent()) ?? '')
    .replace(/-/g, '')
    .trim();
  expect(recoveryCode).toHaveLength(16);
  const finish = page.getByRole('button', { name: tc('ownerSecurity', 'wizard.finish') });
  await expect(finish).toBeDisabled();
  await page.getByLabel(tc('ownerSecurity', 'recoveryCodes.acknowledge')).check();
  await finish.click();
  await expect(page).toHaveURL(/\/platform-owners/);

  await page
    .getByRole('button', { name: new RegExp(tc('nav', 'userMenu.label')) })
    .first()
    .click();
  await page.getByRole('menuitem', { name: tc('nav', 'userMenu.signOut') }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test('sign in again with the authenticator code, the device is remembered', async () => {
  const page = myDevice;
  await passwordStep(page, owner.password);
  await typeCode(page, tc('cockpit', 'signIn.code.label'), await freshTotp(owner.secret!));
  await page.getByRole('button', { name: tc('cockpit', 'signIn.signIn') }).click();
  await expect(page).toHaveURL(/\/platform-owners/);
});

test('a new device asks for both codes; a recovery code signs in', async ({ browser, request }) => {
  // A fresh profile has no device cookie: that is a new device.
  const page = await newDevice(browser);
  await clearCodes(request, owner);
  await passwordStep(page, owner.password);
  await page.getByRole('button', { name: tc('cockpit', 'signIn.code.useRecovery') }).click();
  await typeCode(page, tc('cockpit', 'signIn.code.recoveryLabel'), recoveryCode);
  await page.getByRole('button', { name: tc('cockpit', 'signIn.signIn') }).click();
  await expect(
    page.getByRole('heading', { name: tc('cockpit', 'signIn.device.title') }),
  ).toBeVisible();
  await typeCode(page, tc('cockpit', 'signIn.device.smsLabel'), await smsCode(request, owner));
  await typeCode(page, tc('cockpit', 'signIn.device.emailLabel'), await emailCode(request, owner));
  await page.getByRole('button', { name: tc('cockpit', 'signIn.signIn') }).click();
  await expect(page).toHaveURL(/\/platform-owners/);
  await page.context().close();
});

// axe + reflow on the signed-out screens; the phone project runs it at 390 px.
test('the sign-in screens pass axe and do not scroll sideways', async ({ browser }) => {
  const page = await newDevice(browser);
  for (const path of ['/sign-in', '/sign-in/forgot', '/sign-in/reset']) {
    await page.goto(path);
    await expectAccessiblePage(page);
  }
  await page.context().close();
});
