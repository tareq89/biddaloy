import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

/** `/login` (`client-admin/src/routes/login.tsx`). */
export class LoginPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/login');
    await this.expectLoaded();
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: t('auth.heading') })).toBeVisible();
  }

  async login(identifier: string, password: string): Promise<void> {
    await this.page.getByLabel(t('auth.identifier.label')).fill(identifier);
    await this.page.getByLabel(t('auth.password.label'), { exact: true }).fill(password);
    await this.page.getByRole('button', { name: t('auth.submit.action') }).click();
  }

  async expectInvalidCredentials(): Promise<void> {
    await expect(this.page.getByText(t('auth.errors.invalidCredentials'))).toBeVisible();
  }

  /**
   * 12.5's passwordless flow: click the "Sign in with code" tab, submit the
   * phone number, wait for `POST /auth/otp/request`'s response (D6's echo
   * flag puts the real code in `debug.otp` — nothing in the UI reads it,
   * this is purely a test hook), then fill and submit that code.
   */
  async loginWithOtp(phone: string): Promise<void> {
    await this.page.getByRole('tab', { name: t('auth.tabs.otp') }).click();
    await this.page.getByLabel(t('auth.otp.phoneLabel')).fill(phone);

    const [response] = await Promise.all([
      this.page.waitForResponse((res) => res.url().includes('/auth/otp/request')),
      this.page.getByRole('button', { name: t('auth.otp.sendCode') }).click(),
    ]);
    const body = (await response.json()) as { debug?: { otp?: string } };
    const otp = body.debug?.otp;
    if (!otp) {
      throw new Error(
        '/auth/otp/request did not echo an OTP — is ACCOUNT_ACCESS_ECHO_SECRETS set?',
      );
    }

    await this.page.getByLabel(t('auth.otp.codeLabel')).fill(otp);
    await this.page.getByRole('button', { name: t('auth.otp.verify') }).click();
  }
}
