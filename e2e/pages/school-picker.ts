import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

/** `/select-school` — radio-style school buttons + continue
 * (`ui/src/components/school-picker.tsx`). */
export class SchoolPickerPage {
  constructor(readonly page: Page) {}

  async expectLoaded(): Promise<void> {
    await expect(this.page).toHaveURL(/\/select-school/);
    await expect(
      this.page.getByRole('heading', { name: t('auth.schoolPicker.heading') }),
    ).toBeVisible();
  }

  async choose(schoolName: string): Promise<void> {
    await this.page.getByRole('radio', { name: new RegExp(schoolName) }).click();
    await this.page.getByRole('button', { name: t('auth.schoolPicker.continue') }).click();
  }
}
