import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

/**
 * Drives any route built on `ui/src/shells/form-shell.tsx`: label-based
 * field fill, submit, the error-summary pattern (`role="alert"` listing
 * every problem), and toast assertions.
 */
export class FormShellPage {
  constructor(readonly page: Page) {}

  /** `fillField('students.form.fields.fullName', 'Rahim')` — labels only,
   * which is what keeps this an a11y canary: an unlabeled input fails
   * the suite before it fails a screen-reader user. */
  async fillField(labelKey: string, value: string): Promise<void> {
    await this.page.getByLabel(t(labelKey), { exact: true }).fill(value);
  }

  async submit(labelKey: string): Promise<void> {
    await this.page.getByRole('button', { name: t(labelKey) }).click();
  }

  /** FormShell's submit-failure summary — a `role="alert"` region listing
   * each problem as a link that moves focus to the offending field. */
  async expectErrorSummary(): Promise<void> {
    // Field-level messages are role="alert" too — the summary is the
    // labelled region FormShell renders first (aria-labelledby points at
    // its own "N problems" heading).
    await expect(this.page.locator('[role="alert"][aria-labelledby]')).toBeVisible();
  }

  /** A specific field error, by its message translation key. */
  async expectFieldError(messageKey: string): Promise<void> {
    await expect(this.page.getByText(t(messageKey)).first()).toBeVisible();
  }

  /** Sonner toasts render as status/alert content in the notifications
   * region. */
  async expectToast(text: string): Promise<void> {
    await expect(this.page.getByText(text).first()).toBeVisible();
  }
}
