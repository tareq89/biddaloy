import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

/**
 * `/forgot-password` (`client-admin/src/routes/forgot-password.tsx`) —
 * 12.4's self-service recovery flow. One page object for the whole
 * identifier → code → password state machine, mirroring the route's own
 * single-component shape.
 */
export class ForgotPasswordPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/forgot-password');
    await expect(this.page.getByRole('heading', { name: t('auth.forgot.heading') })).toBeVisible();
  }

  /** Clicks the "Forgot password?" link from an already-loaded `/login`. */
  async gotoFromLogin(): Promise<void> {
    await this.page.getByRole('link', { name: t('auth.forgot.link') }).click();
    await expect(this.page.getByRole('heading', { name: t('auth.forgot.heading') })).toBeVisible();
  }

  async submitIdentifier(identifier: string): Promise<void> {
    await this.page.getByLabel(t('auth.forgot.identifierLabel')).fill(identifier);
    await this.page.getByRole('button', { name: t('auth.forgot.continue') }).click();
  }

  async expectCodeStep(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: t('auth.forgot.codeHeading') }),
    ).toBeVisible();
  }

  async enterCode(otp: string): Promise<void> {
    await this.page.getByLabel(t('auth.forgot.codeLabel')).fill(otp);
    await this.page.getByRole('button', { name: t('auth.forgot.continue') }).click();
  }

  async setNewPassword(password: string): Promise<void> {
    await this.page.getByLabel(t('auth.setPassword.label'), { exact: true }).fill(password);
    await this.page.getByLabel(t('auth.setPassword.confirmLabel')).fill(password);
    await this.page.getByRole('button', { name: t('auth.setPassword.submit') }).click();
  }
}
