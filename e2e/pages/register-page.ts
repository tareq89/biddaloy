import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

export interface RegisterDetails {
  adminName: string;
  schoolName: string;
  address: string;
  phone: string;
  email: string;
}

/** `/register` (`client-admin/src/features/registration`): details, code, password. */
export class RegisterPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/register');
    await expect(this.page.getByRole('heading', { name: t('register.title') })).toBeVisible();
  }

  /** Fills the card and continues; returns the code the server echoed (`debug.otp`). */
  async submitDetails(d: RegisterDetails): Promise<string> {
    const { page } = this;
    await page.getByLabel(t('register.fields.adminName')).fill(d.adminName);
    await page.getByLabel(t('register.fields.schoolName')).fill(d.schoolName);
    await page.getByLabel(t('register.fields.address')).fill(d.address);
    await page.getByLabel(t('register.fields.phone')).fill(d.phone);
    await page.getByLabel(t('register.fields.email')).fill(d.email);
    await page.getByRole('checkbox', { name: t('register.terms') }).check();
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/auth/register/start')),
      page.getByRole('button', { name: t('register.continue') }).click(),
    ]);
    const otp = ((await response.json()) as { debug?: { otp?: string } }).debug?.otp;
    if (!otp) throw new Error('register/start did not echo an OTP — ACCOUNT_ACCESS_ECHO_SECRETS?');
    return otp;
  }

  async submitCode(otp: string): Promise<void> {
    await expect(this.page.getByRole('heading', { name: t('register.otp.title') })).toBeVisible();
    await this.page.getByLabel(t('register.otp.title')).fill(otp);
    await this.page.getByRole('button', { name: t('register.otp.verify') }).click();
  }

  /** Types a weak value first to see unmet rules, then the real one until every rule is green. */
  async setPassword(password: string): Promise<void> {
    const { page } = this;
    const field = page.getByLabel(t('auth.setPassword.label'), { exact: true });
    const unmet = page.getByText(t('auth.passwordRules.unmet'), { exact: true });
    await expect(page.getByRole('heading', { name: t('register.password.title') })).toBeVisible();
    await field.fill('abc');
    await expect(unmet.first()).toBeVisible();
    await field.fill(password);
    await expect(unmet).toHaveCount(0);
    await page.getByLabel(t('auth.setPassword.confirmLabel')).fill(password);
    await page.getByRole('button', { name: t('register.password.save') }).click();
  }
}
