import { adminApiSession, createInvitedParentUser } from '../api';
import { guest, test, expect } from '../fixtures/test';
import { LoginPage } from '../pages/login-page';

/**
 * [12.5] A guardian who was never given a password signs in with phone +
 * OTP, end to end, at the 320×568 viewport the issue's own AC calls out
 * (guardians open this from a phone).
 *
 * `createInvitedParentUser` (12.4's helper) already creates the account
 * passwordless with a unique phone and ACTIVE status by default (`User`
 * entity's default — see `users.service.ts`'s `create()`, no `INACTIVE`
 * override happens for a passwordless create) — there is no invite/activate
 * step to run first, unlike `password-recovery.spec.ts`'s journey, which
 * needs a *real* password to have forgotten before recovery even makes
 * sense. This account never gets one; `/auth/otp/verify` is its only way in.
 */
test.describe('guardian passwordless sign-in', () => {
  test.use(guest);

  test('a guardian with no password signs in via phone + OTP', async ({ page, request }) => {
    await page.setViewportSize({ width: 320, height: 568 });

    const admin = await adminApiSession(request);
    const guardian = await createInvitedParentUser(request, admin, 'Guardian OTP E2E');

    const login = new LoginPage(page);
    await login.goto();
    await login.loginWithOtp(guardian.phone);

    await expect(page).toHaveURL(/\/portal/);
  });
});
