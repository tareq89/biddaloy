import { expect, type Locator, type Page } from '@playwright/test';

import { t } from '../i18n';

export interface ListShellConfig {
  /** Translation key of the page title, e.g. `students.list.title`. */
  titleKey: string;
  /** Translation key of the search box's accessible label, when the
   * route has one (it lives in the route's own filter bar, not in
   * `ListShell` itself). */
  searchLabelKey?: string;
  /** Translation key of the row's "view" link when the row carries more
   * than one link (e.g. students rows lead with a collect-fees action);
   * omitted, `openRowByText` clicks the row's first link. */
  openLabelKey?: string;
}

/**
 * Drives any route built on `ui/src/shells/list-shell.tsx` +
 * `DataTable`. Written once — a new list route needs a `ListShellConfig`
 * (two translation keys), never new table-driving code.
 */
export class ListShellPage {
  constructor(
    readonly page: Page,
    readonly config: ListShellConfig,
  ) {}

  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { level: 1, name: t(this.config.titleKey) }),
    ).toBeVisible();
  }

  /** Data rows only — excludes the header row and any placeholder
   * (loading/empty/error) row, which renders a single full-width cell. */
  dataRows(): Locator {
    return this.page.locator('table > tbody > tr:not(:has(td[colspan]))');
  }

  async expectResultCount(n: number): Promise<void> {
    await expect(this.dataRows()).toHaveCount(n);
  }

  async search(query: string): Promise<void> {
    if (!this.config.searchLabelKey) {
      throw new Error(`No searchLabelKey configured for ${this.config.titleKey}`);
    }
    await this.page.getByLabel(t(this.config.searchLabelKey)).fill(query);
  }

  row(text: string): Locator {
    return this.dataRows().filter({ hasText: text });
  }

  /** Opens a row's detail view. */
  async openRowByText(text: string): Promise<void> {
    const row = this.row(text).first();
    const link = this.config.openLabelKey
      ? row.getByRole('link', { name: t(this.config.openLabelKey) })
      : row.getByRole('link').first();
    await link.click();
  }

  async expectEmptyState(messageKey: string): Promise<void> {
    await expect(this.page.getByText(t(messageKey))).toBeVisible();
  }

  /** DataTable renders load failures as `role="alert"` inside the table. */
  async expectErrorState(messageKey?: string): Promise<void> {
    const alert = this.page.getByRole('alert');
    await expect(alert).toBeVisible();
    if (messageKey) await expect(alert).toHaveText(t(messageKey));
  }

  // DataTable's pagination strings are currently untranslated English
  // literals (data-table.tsx) — these locators track that markup.
  async nextPage(): Promise<void> {
    await this.pagerClick('Next');
  }

  async previousPage(): Promise<void> {
    await this.pagerClick('Previous');
  }

  /** The pager sits under the table, whose rows re-render as data
   * settles — Playwright's stability check never converges. Waiting for
   * enabled and dispatching the click on the element is equivalent for a
   * plain button and immune to layout shift above it. */
  private async pagerClick(name: 'Next' | 'Previous'): Promise<void> {
    const button = this.page.getByRole('button', { name, exact: true });
    await expect(button).toBeEnabled();
    await button.evaluate((el) => (el as HTMLButtonElement).click());
  }
}
