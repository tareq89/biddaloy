import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** `/staff/import` (`client-admin/src/features/staff-import`). */
export class StaffImportPage {
  constructor(readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/staff/import');
    await expect(
      this.page.getByRole('heading', { level: 1, name: t('staffImport.title') }),
    ).toBeVisible();
  }

  async upload(file: UploadFile): Promise<void> {
    await this.page.getByLabel(t('bulkImport.chooseFile')).setInputFiles(file);
  }

  confirmButton() {
    return this.page.getByRole('button', { name: t('bulkImport.confirm'), exact: true });
  }

  async setInvitations(on: boolean): Promise<void> {
    await this.page
      .getByRole('checkbox', { name: t('staffImport.sendInvitations') })
      .setChecked(on);
  }
}
