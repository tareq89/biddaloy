import { expect, type Page } from '@playwright/test';

import { makeT, type Locale } from '../i18n';
import { expectUrlParam } from './assertions';

/**
 * Drives any route built on `ui/src/shells/detail-shell.tsx`: header
 * (entity name), WAI-ARIA tab strip (URL-backed via `useDetailShellTab`),
 * primary actions.
 */
export class DetailShellPage {
  private readonly t: ReturnType<typeof makeT>;

  constructor(
    readonly page: Page,
    locale: Locale = 'bn',
  ) {
    this.t = makeT(locale);
  }

  async expectLoaded(name: string): Promise<void> {
    await expect(this.page.getByRole('heading', { level: 1, name })).toBeVisible();
  }

  /** `openTab('students.detail.tabs.fees', 'fees')` — the second argument
   * is the tab id persisted to `?tab=` by `useDetailShellTab`. */
  async openTab(labelKey: string, tabId: string): Promise<void> {
    await this.page.getByRole('tab', { name: this.t(labelKey) }).click();
    await expect(this.page.getByRole('tabpanel', { name: this.t(labelKey) })).toBeVisible();
    await expectUrlParam(this.page, 'tab', tabId);
  }

  /** A primary action by its translation key, e.g.
   * `action('students.detail.actions.edit')`. */
  async clickAction(labelKey: string): Promise<void> {
    await this.page.getByRole('button', { name: this.t(labelKey) }).click();
  }
}
