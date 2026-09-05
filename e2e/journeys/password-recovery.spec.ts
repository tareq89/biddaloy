import { adminApiSession, createInvitedParentUser, createStaffUser } from '../api';
import { guest, loggedIn, test, expect } from '../fixtures/test';
import { ActivatePage } from '../pages/activate-page';
import { ForgotPasswordPage } from '../pages/forgot-password-page';
import { LoginPage } from '../pages/login-page';
import { t } from '../i18n';

/**
 * [12.4] Journey 1: a guardian recovers a forgotten password via phone
 * OTP, at the 320×568 viewport the AC calls out (guardians open this from
 * a phone). The account first needs a *real* password to have forgotten —
 * `createInvitedParentUser` issues one passwordless, then `ActivatePage`
 * consumes the invite exactly like `activation.spec.ts` does, before the
 * recovery flow ever starts.
 *
 * The OTP itself comes from intercepting the `/auth/forgot-password`
 * response's `debug.otp` (only populated behind
 * `ACCOUNT_ACCESS_ECHO_SECRETS=true`, same flag `createInvitedParentUser`
 * already requires) rather than a real SMS — there is no SMS provider in
 * the e2e environment.
 */
test.describe('guardian phone recovery', () => {
  test.use(guest);

  test('a guardian recovers a forgotten password via phone OTP', async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 568 });

    const admin = await adminApiSession(request);
    const guardian = await createInvitedParentUser(request, admin, 'Guardian Recovery E2E');

    const activate = new ActivatePage(page);
    const login = new LoginPage(page);
    const forgotPassword = new ForgotPasswordPage(page);

    await test.step('give the account a real password to recover later', async () => {
      await activate.goto(guardian.token);
      await activate.expectWelcome('Guardian Recovery E2E');
      await activate.setPassword('an-original-password');
      await expect(page).toHaveURL(/\/portal/);
    });

    await test.step('sign out and start recovery from the login screen', async () => {
      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
      await login.goto();
      await forgotPassword.gotoFromLogin();
    });

    await test.step('request a code by phone and read it from the debug echo', async () => {
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/api/v1/auth/forgot-password')),
        forgotPassword.submitIdentifier(guardian.phone),
      ]);
      const body = (await response.json()) as { debug?: { otp?: string } };
      const otp = body.debug?.otp;
      if (!otp) {
        throw new Error(
          'No debug.otp in the forgot-password response — is ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
        );
      }

      await forgotPassword.expectCodeStep();
      await forgotPassword.enterCode(otp);
    });

    await test.step('set a new password and land back in the portal, signed in', async () => {
      await forgotPassword.setNewPassword('a-recovered-password');
      await expect(page).toHaveURL(/\/portal/);
    });
  });
});

/**
 * [12.4] Journey 2: an admin resets a staff member's password from
 * `/staff/$userId` — confirm dialog, revocation warning, success toast.
 */
test.describe('admin staff-detail reset', () => {
  test.use(loggedIn('admin'));

  test('an admin resets a staff member’s password from the detail page', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const staffMember = await createStaffUser(request, admin, 'Staff Reset E2E');

    await page.goto(`/staff/${staffMember.id}`);
    await expect(page.getByText('Staff Reset E2E')).toBeVisible();

    await page.getByRole('button', { name: t('staff.detail.actions.resetPassword') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(t('staff.resetDialog.title'))).toBeVisible();

    await dialog.getByRole('button', { name: t('staff.resetDialog.confirm') }).click();

    await expect(
      page.getByText(t('staff.resetDialog.success', { name: 'Staff Reset E2E' })),
    ).toBeVisible();
  });
});
