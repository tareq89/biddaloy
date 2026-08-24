import { expect, type Page } from '@playwright/test';

import { t } from '../i18n';

/**
 * Drives the persistent chrome every staff screen shares
 * (`ui/src/components/app-shell.tsx` wired by
 * `client-admin/src/routes/_staff.tsx`): sidebar nav, tenant bar, global
 * search. Locators are role/label-based on purpose — the suite doubles
 * as an accessibility canary (see README.md).
 */
export class AppShellPage {
  constructor(readonly page: Page) {}

  /** Sidebar link by its `nav.items.*` translation key, e.g.
   * `navigateTo('nav.items.students')`. */
  async navigateTo(tKey: string): Promise<void> {
    const nav = this.page.getByRole('navigation', { name: t('nav.navLabel') });
    await nav.getByRole('link', { name: t(tKey), exact: true }).click();
  }

  /** The tenant bar shows the active school's name. */
  async expectCurrentSchool(name: string): Promise<void> {
    await expect(this.page.getByText(name).first()).toBeVisible();
  }

  async openSchoolSwitcher(): Promise<void> {
    await this.page
      .getByRole('button', { name: t('nav.tenantBar.switchSchoolOrRole') })
      .or(this.page.getByRole('button', { name: t('nav.tenantBar.switchSchool') }))
      .first()
      .click();
  }

  /** Cmd/Ctrl+K palette ([8.9.9]) — opened via its toolbar button; the
   * keyboard shortcut itself is covered by the a11y/keyboard suite. */
  async openGlobalSearch(): Promise<void> {
    await this.page.getByRole('button', { name: t('nav.globalSearch.buttonLabel') }).click();
    await expect(this.searchInput()).toBeVisible();
  }

  async searchFor(query: string): Promise<void> {
    await this.searchInput().fill(query);
  }

  async pickSearchResult(text: string): Promise<void> {
    await this.page.getByRole('option', { name: text }).click();
  }

  private searchInput() {
    return this.page.getByRole('combobox', { name: t('nav.globalSearch.ariaLabel') });
  }

  /** Permission assertions: is a sidebar item rendered for this role? */
  async expectNavItem(tKey: string, visible: boolean): Promise<void> {
    const nav = this.page.getByRole('navigation', { name: t('nav.navLabel') });
    const link = nav.getByRole('link', { name: t(tKey), exact: true });
    if (visible) await expect(link).toBeVisible();
    else await expect(link).toHaveCount(0);
  }

  /** Tenant-bar school switch, driving the confirm dialog. */
  async switchSchool(schoolName: string): Promise<void> {
    await this.openSchoolSwitcher();
    await this.page.getByRole('menuitem', { name: new RegExp(schoolName) }).click();
    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: t('nav.tenantBar.confirm'), exact: true })
      .click();
  }
}
