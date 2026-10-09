import { adminApiSession, createInvitedParentUser, E2E_PASSWORD } from '../api';
import { guest, test, expect } from '../fixtures/test';
import { t } from '../i18n';
import { LoginPage } from '../pages/login-page';

/**
 * [13.7.1] First sign-in with a code (13.5.3): an invited teacher (no password
 * yet) uses "First time here?", gets a code, and must then set a password;
 * a guardian may skip it. Each test makes its own invited person over the API.
 */
test.describe('first sign-in with a code', () => {
  test.use(guest);

  test('a teacher must set a password, then lands in the school and sees the hint', async ({
    page,
    request,
  }) => {
    // The hint only shows when a provider is configured; none is in e2e.
    await page.route('**/api/v1/auth/social/providers', (route) =>
      route.fulfill({ json: { providers: ['google'] } }),
    );
    const admin = await adminApiSession(request);
    const teacher = await createInvitedParentUser(request, admin, 'First Login Teacher', 'TEACHER');

    const login = new LoginPage(page);
    await login.goto();
    await page.getByRole('link', { name: t('auth.login.firstTime') }).click();
    await login.requestAndEnterOtp(teacher.phone);

    await expect(
      page.getByRole('heading', { name: t('auth.firstPassword.heading') }),
    ).toBeVisible();
    // Staff may not skip it.
    await expect(page.getByRole('button', { name: t('auth.setPassword.skip') })).toHaveCount(0);
    await page.getByLabel(t('auth.setPassword.label'), { exact: true }).fill(E2E_PASSWORD);
    await page.getByLabel(t('auth.setPassword.confirmLabel')).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: t('auth.setPassword.submit') }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: t('setupChecklist.hint.title') })).toBeVisible();
  });

  test('a guardian can skip the password', async ({ page, request }) => {
    const admin = await adminApiSession(request);
    const guardian = await createInvitedParentUser(request, admin, 'First Login Guardian');

    const login = new LoginPage(page);
    await login.goto();
    await page.getByRole('link', { name: t('auth.login.firstTime') }).click();
    await login.requestAndEnterOtp(guardian.phone);

    await page.getByRole('button', { name: t('auth.setPassword.skip') }).click();
    await expect(page).toHaveURL(/\/portal/);
  });
});
