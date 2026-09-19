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
   * is the tab id persisted to `?tab=` by `useDetailShellTab`.
   *
   * `exact: true` matters here: Playwright's default `name` match is a
   * normalized *substring* match, and since [16.7.5] added a "Recurring
   * fees" tab (`পুনরাবৃত্ত ফি`) alongside the existing "Fees" tab (`ফি`),
   * the Bengali label for the former contains the latter as a literal
   * substring — an un-exact match resolves `getByRole('tab', { name:
   * 'ফি' })` to both tabs and throws a strict-mode violation. */
  async openTab(labelKey: string, tabId: string): Promise<void> {
    await this.page.getByRole('tab', { name: this.t(labelKey), exact: true }).click();
    await expect(
      this.page.getByRole('tabpanel', { name: this.t(labelKey), exact: true }),
    ).toBeVisible();
    await expectUrlParam(this.page, 'tab', tabId);
  }

  /** An action by its translation key, e.g.
   * `clickAction('students.detail.actions.edit')`. Inline (primary,
   * secondary, lone destructive) actions render as buttons; per §11 of
   * `docs/architecture/09-design-direction.md`, tertiary and non-lone
   * destructive actions collapse into an overflow menu opened by a "More
   * actions" button and render as `menuitem`s instead. This checks for
   * the inline button first and only opens the overflow menu if it isn't
   * there, so it works for either case without callers needing to know
   * which tier an action landed in. */
  async clickAction(labelKey: string): Promise<void> {
    const label = this.t(labelKey);
    const inline = this.page.getByRole('button', { name: label });
    const more = this.page.getByRole('button', { name: this.t('common.actions.moreActions') });
    // `count()` does not wait. Called straight after a `goto()`, before the
    // detail has rendered, it answered 0 for an inline action and this then
    // waited on a "More actions" menu that never existed. Let either
    // control appear first, then decide.
    await expect(inline.or(more).first()).toBeVisible();
    if ((await inline.count()) > 0) {
      await inline.first().click();
      return;
    }
    await more.click();
    await this.page.getByRole('menuitem', { name: label }).click();
  }
}
