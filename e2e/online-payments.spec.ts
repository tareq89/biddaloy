import type { Browser, BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

import {
  activateInvite,
  createGuardian,
  createStudentWithDues,
  get,
  loginAsFreshUser,
  patch,
  platformApiSession,
  post,
  provisionSchool,
  resendSchoolAdminInvitation,
  type ApiSession,
} from './api';
import { shells } from './config';
import { startBkashStub, type BkashStub } from './fixtures/bkash-stub';
import { expect, test } from './fixtures/test';
import { makeT } from './i18n';
import { LoginPage } from './pages/login-page';

/**
 * [Epic 3 / #3997] Wave 7 close journey (guardian in bn, accountant in en): a guardian pays through bKash, the result page
 * says paid with the receipt number and the invoice says how it was paid; a second child's payment
 * is cancelled at bKash; the accountant sees the paid one on the Online tab.
 *
 * bKash is a fake on 127.0.0.1 (e2e/fixtures/bkash-stub.ts) reached through the test-only seam in
 * `BkashClient` (08-security Rule 7), so no real company is called. The bKash page itself is never
 * opened: the test plays bKash's redirect by calling our callback URL with the paymentID.
 *
 * Own school: turning online payment on is school-wide, and it would hide the proof form of the
 * shared seeded school for every spec running beside this one.
 * Local runs: a dev server already on :3000 is reused as is, so start it with `NODE_ENV=test`,
 * `OUTBOUND_TEST_ALLOW_LOOPBACK=true` and `BKASH_TEST_BASE_URL=http://127.0.0.1:38417/v1.2.0-beta`
 * or stop it first. CI never reuses a server.
 */
const t = makeT('bn');
const ADMIN_PASSWORD = 'A-strong-online-pw-1';
const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const phone = `018${suffix.slice(-8)}`;
const childA = `Online Child A ${suffix}`;
const childB = `Online Child B ${suffix}`;

let stub: BkashStub;
let admin: ApiSession;
let adminEmail: string;
let studentA: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ playwright }) => {
  stub = await startBkashStub();
  const request = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const superAdmin = await platformApiSession(request);
    adminEmail = `online-admin-${suffix}@e2e.example.com`;
    const school = await provisionSchool(
      request,
      superAdmin,
      `E2E Online School ${suffix}`,
      `e2e-online-school-${suffix}`,
      'Online Admin',
      adminEmail,
    );
    const token = await resendSchoolAdminInvitation(
      request,
      superAdmin,
      school.schoolId,
      school.adminUserId,
    );
    const activated = await activateInvite(request, token, ADMIN_PASSWORD);
    admin = { token: activated.token, tenantId: activated.tenantId };
    await patch(request, admin, '/onboarding', { seen: true });
    await patch(request, admin, `/schools/${admin.tenantId}/settings`, {
      version: 1,
      payments: {
        bkash: {
          environment: 'SANDBOX',
          appKey: 'stub-key',
          appSecret: 'stub-secret',
          username: 'stub-user',
          password: 'stub-pass',
        },
      },
    });
    // The switch only turns on after a good test of the saved credentials (against the stub).
    await post(request, admin, '/settings/payments/bkash/test', {});
    await patch(request, admin, `/schools/${admin.tenantId}/settings`, {
      version: 1,
      payments: { onlineEnabled: true },
    });
    const guardian = await createGuardian(request, admin, `Online Guardian ${suffix}`, phone);
    studentA = (await createStudentWithDues(request, admin, childA, { guardianId: guardian.id }))
      .studentId;
    await createStudentWithDues(request, admin, childB, { guardianId: guardian.id });
    const batch = await post<{ batch_id: string }>(request, admin, '/users/invitations/batch', {
      guardian_ids: [guardian.id],
    });
    await expect
      .poll(
        async () =>
          (
            await get<{ queued: number }>(
              request,
              admin,
              `/users/invitations/batch/${batch.batch_id}`,
            )
          ).queued,
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toBe(0);
  } finally {
    await request.dispose();
  }
});

test.afterAll(async () => {
  await stub?.close();
});

async function englishContext(
  browser: Browser,
  storageState?: BrowserContextOptions['storageState'],
): Promise<BrowserContext> {
  const context = await browser.newContext(storageState ? { storageState } : {});
  await context.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));
  return context;
}

/** Ticks only `child`, presses Pay with bKash, and returns the paymentID bKash would hold. */
async function payFor(page: Page, child: string, other: string): Promise<string> {
  await page.goto('/portal/fees/pay');
  const otherBox = page.getByRole('group', { name: other }).getByRole('checkbox');
  await expect(page.getByRole('group', { name: child }).getByRole('checkbox')).toBeChecked();
  // A child whose bill is already paid has no group on the page: nothing to untick.
  if ((await otherBox.count()) > 0 && (await otherBox.isChecked())) await otherBox.click();
  // The bKash page is not ours to open: hold the browser at its address.
  await page.unroute('https://pay.stub.example/**');
  await page.route('https://pay.stub.example/**', (route) => route.abort());
  const sent = page.waitForRequest('https://pay.stub.example/**');
  await page.getByRole('button', { name: /^বিকাশে .* দিন$/ }).click();
  return new URL((await sent).url()).pathname.slice(1);
}

test('guardian pays, result says paid with a receipt, cancelled one fails, accountant sees it', async ({
  browser,
  playwright,
  request,
}) => {
  test.setTimeout(240_000);
  const guardianContext = await browser.newContext();
  const adminApi = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  const adminContext = await englishContext(
    browser,
    await loginAsFreshUser(adminApi, shells.app.baseURL, adminEmail, ADMIN_PASSWORD),
  );
  try {
    const page = await guardianContext.newPage();
    await test.step('guardian signs in for the first time', async () => {
      const login = new LoginPage(page);
      await login.goto();
      await page.getByRole('link', { name: t('auth.login.firstTime') }).click();
      await login.requestAndEnterOtp(phone);
      await page.getByRole('button', { name: t('auth.setPassword.skip') }).click();
      await expect(page).toHaveURL(/\/portal/);
    });

    const callback = (paymentID: string, status: 'success' | 'cancel') =>
      `/api/v1/online-payments/callback?paymentID=${paymentID}&status=${status}`;

    await test.step('paid: result says paid with the receipt number', async () => {
      const paymentID = await payFor(page, childA, childB);
      await page.goto(callback(paymentID, 'success'));
      await expect(page).toHaveURL(/\/portal\/fees\/pay\/result\?id=/);
      await expect(
        page.getByRole('heading', { name: t('portalPay.result.paidTitle') }),
      ).toBeVisible();
      await expect(page.getByText(/পরিশোধ হয়েছে। রসিদ /)).toBeVisible();
    });

    await test.step('the invoice says how it was paid', async () => {
      const list = await get<{ data: { id: string }[] }>(
        request,
        admin,
        `/invoices?student_id=${studentA}`,
      );
      expect(list.data[0]?.id, 'a paid online payment makes an invoice').toBeTruthy();
      const print = await request.get(`/api/v1/invoices/${list.data[0]!.id}/print`, {
        headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId ?? '' },
      });
      expect(print.ok()).toBe(true);
      expect(await print.text()).toContain('How it was paid');
    });

    await test.step('cancelled at bKash: result says not done and offers proof', async () => {
      const paymentID = await payFor(page, childB, childA);
      stub.cancelled.add(paymentID);
      await page.goto(callback(paymentID, 'cancel'));
      await expect(
        page.getByRole('heading', { name: t('portalPay.result.failedTitle') }),
      ).toBeVisible();
      await expect(
        page.getByRole('link', { name: t('portalPay.result.submitProof') }),
      ).toHaveAttribute('href', '/portal/fees/pay?how=proof');
    });

    await test.step('accountant sees the paid one on the Online tab', async () => {
      const staff = await adminContext.newPage();
      await staff.goto('/payments/online?tab=online');
      await expect(staff.getByRole('cell', { name: new RegExp(childA) })).toBeVisible();
    });
  } finally {
    await guardianContext.close();
    await adminContext.close();
    await adminApi.dispose();
  }
});
