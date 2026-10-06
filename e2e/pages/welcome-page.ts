import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

/** `/welcome` (`client-admin/src/features/onboarding`): doors, a setup path, people, done. */
export class WelcomePage {
  constructor(readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/welcome/);
    await expect(
      this.page.getByRole('heading', { name: t('onboardingSetup.doors.heading') }),
    ).toBeVisible();
  }

  door(key: 'guided' | 'excel' | 'later') {
    return this.page.getByRole('radio', { name: t(`onboardingSetup.doors.${key}.title`) });
  }

  button(key: string) {
    return this.page.getByRole('button', { name: t(`onboardingSetup.${key}`) });
  }

  async next(): Promise<void> {
    await this.button('footer.next').click();
  }
}
