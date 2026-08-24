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
}
