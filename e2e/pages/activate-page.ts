import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

/** `/activate?token=…` (`client-admin/src/routes/activate.tsx`). */
export class ActivatePage {
  constructor(readonly page: Page) {}

  async goto(token: string): Promise<void> {
    await this.page.goto(`/activate?token=${token}`);
  }

  async expectWelcome(name: string): Promise<void> {
    await expect(this.page.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  }

  async setPassword(password: string): Promise<void> {
    await this.page.getByLabel(t('auth.setPassword.label'), { exact: true }).fill(password);
    await this.page.getByLabel(t('auth.setPassword.confirmLabel')).fill(password);
    await this.page.getByRole('button', { name: t('auth.setPassword.submit') }).click();
  }

  async expectAlreadyUsed(): Promise<void> {
    await expect(this.page.getByText(t('auth.activate.consumed'))).toBeVisible();
  }
}
