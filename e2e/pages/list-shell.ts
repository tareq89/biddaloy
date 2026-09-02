import { expect, type Locator, type Page } from '@playwright/test';

import { makeT, type Locale } from '../i18n';

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
  private readonly t: ReturnType<typeof makeT>;

  constructor(
    readonly page: Page,
    readonly config: ListShellConfig,
    locale: Locale = 'bn',
  ) {
    this.t = makeT(locale);
  }

  async expectLoaded(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { level: 1, name: this.t(this.config.titleKey) }),
    ).toBeVisible();
  }

  /** Data rows only — excludes the header row, any placeholder
   * (loading/empty/error) row (a single full-width cell), and
   * [8.14.6]'s initial-load skeleton rows (`data-placeholder="skeleton"`
   * on `DataTable`'s own markup) so a `loading` transition never gets
   * counted as data. */
  dataRows(): Locator {
    return this.page.locator('table > tbody > tr:not(:has(td[colspan])):not([data-placeholder])');
  }

  /** [8.14.6] The `loading` skeleton rows `DataTable` renders in place
   * of the single "Loading…" cell — real markup, `aria-hidden`, never
   * counted by `dataRows()`. */
  skeletonRows(): Locator {
    return this.page.locator('table > tbody > tr[data-placeholder]');
  }

  async expectResultCount(n: number): Promise<void> {
    await expect(this.dataRows()).toHaveCount(n);
  }

  /** [8.14.6] `DataTable`'s scroll region carries `aria-busy` while
   * `loading` or refetching (`isFetching`) rows are stale on screen —
   * asserts that flag directly rather than inferring it from row
   * count/opacity. The region's accessible name is the route's own
   * `caption` prop (a namespace `ListShellConfig` doesn't track), so this
   * scopes by role plus "contains a `<table>`" rather than by name —
   * `getByRole('region')` alone also matches Sonner's unconditional
   * `<section role="region" aria-label="Notifications ...">` toaster
   * (`client-admin/src/main.tsx`), which would make this a strict-mode
   * violation on every page. */
  async expectBusy(busy: boolean): Promise<void> {
    await expect(
      this.page.getByRole('region').filter({ has: this.page.locator('table') }),
    ).toHaveAttribute('aria-busy', String(busy));
  }

  async search(query: string): Promise<void> {
    if (!this.config.searchLabelKey) {
      throw new Error(`No searchLabelKey configured for ${this.config.titleKey}`);
    }
    await this.page.getByLabel(this.t(this.config.searchLabelKey)).fill(query);
  }

  row(text: string): Locator {
    return this.dataRows().filter({ hasText: text });
  }

  /** Opens a row's detail view. */
  async openRowByText(text: string): Promise<void> {
    const row = this.row(text).first();
    const link = this.config.openLabelKey
      ? row.getByRole('link', { name: this.t(this.config.openLabelKey) })
      : row.getByRole('link').first();
    await link.click();
  }

  async filterBySelect(labelKey: string, optionText: string): Promise<void> {
    await this.page.getByRole('combobox', { name: this.t(labelKey) }).click();
    await this.page.getByRole('option', { name: optionText }).click();
  }

  async expectEmptyState(messageKey: string): Promise<void> {
    await expect(this.page.getByText(this.t(messageKey))).toBeVisible();
  }

  /** DataTable renders load failures as `role="alert"` inside the table. */
  async expectErrorState(messageKey?: string): Promise<void> {
    const alert = this.page.getByRole('alert');
    await expect(alert).toBeVisible();
    if (messageKey) await expect(alert).toHaveText(this.t(messageKey));
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
