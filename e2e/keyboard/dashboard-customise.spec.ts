import type { Page } from '@playwright/test';

import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [8.10.7.2.99] Dashboard customise mode, KEYBOARD ONLY (no `page.mouse`, no
 * `.click(` in the journeys): reach Dashboard from the nav, open Customise, hide
 * one widget with Space, move the next with Alt+ArrowDown, save with Enter. A second
 * run leaves with Esc and checks that nothing was saved.
 *
 * Widget titles come from the dashboard catalogue: the first two of the admin's
 * default layout are `attendance-today` then `staff-today`.
 */

test.use(loggedIn('admin'));

const FIRST = () => t('dashboard.widgets.attendance-today.title');
const SECOND = () => t('dashboard.widgets.staff-today.title');
const checkbox = (page: Page, title: string) =>
  page.getByRole('region', { name: t('dashboard.customise.panelTitle') }).getByRole('checkbox', {
    name: title,
  });

/** `openFromSidebar` starts on /dashboard, where Enter on its own link is no navigation: start elsewhere. */
async function openDashboardFromSidebar(page: Page) {
  const label = t('nav.items.dashboard');
  await page.goto('/students');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await tabUntilFocused(page, label, 150, { tag: 'a', exact: true });
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { level: 1, name: t('dashboard.page.title') });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
}

async function openCustomiseByKeyboard(page: Page) {
  await openDashboardFromSidebar(page);
  await tabUntilFocused(page, t('dashboard.page.customise'), 30, { tag: 'button' });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/customize=1/);
  // The Customise button unmounts: land on the first widget row from the top of the page.
  await tabUntilFocused(page, FIRST(), 60, { tag: 'button' });
  await expect(checkbox(page, FIRST())).toBeFocused();
}

test('Space hides, Alt+ArrowDown moves, Enter saves', async ({ page }) => {
  try {
    await openCustomiseByKeyboard(page);

    await page.keyboard.press('Space');
    await expect(checkbox(page, FIRST())).not.toBeChecked();
    await expect(
      page.getByText(t('dashboard.customise.hiddenNow', { title: FIRST() })),
    ).toBeAttached();

    // The hidden row sits below the shown list: Shift+Tab back up to staff-today, now first
    // in it, and move it one place down.
    await tabUntilFocused(page, SECOND(), 80, { tag: 'button', shift: true });
    await page.keyboard.press('Alt+ArrowDown');
    await expect(
      page.getByText(t('dashboard.customise.moved', { title: SECOND(), position: 2 })),
    ).toBeAttached();
    await expect(checkbox(page, SECOND())).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/customize=1/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
    ).toBeVisible();
  } finally {
    // Cleanup (not part of the journey): put the admin's layout back to the role default.
    await page.goto('/dashboard?customize=1');
    await page.getByRole('button', { name: t('dashboard.customise.reset') }).click();
    await page.getByRole('button', { name: t('dashboard.customise.save'), exact: true }).click();
    await expect(page).not.toHaveURL(/customize=1/);
  }
});

test('Esc leaves customise mode and saves nothing', async ({ page }) => {
  await openCustomiseByKeyboard(page);
  await page.keyboard.press('Space');
  await expect(checkbox(page, FIRST())).not.toBeChecked();

  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/customize=1/);

  // Back in customise mode the widget is still shown: the hide was never saved.
  await page.goto('/dashboard?customize=1');
  await expect(checkbox(page, FIRST())).toBeChecked();
});
