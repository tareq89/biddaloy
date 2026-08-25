import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { makeT, type Locale } from '../i18n';
import { DetailShellPage } from '../pages/detail-shell';
import { ListShellPage } from '../pages/list-shell';

/**
 * [8.5.5] One opener per named overlay in `e2e/route-manifest.json` —
 * puts the page into that dialog/drawer state so the axe scan runs with
 * the overlay OPEN (composition bugs like focus traps and duplicate
 * landmarks only exist then). Built on the #127 page objects.
 */

async function expectDialogOpen(page: Page): Promise<void> {
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function selectFirstDuesRow(page: Page, locale: Locale): Promise<void> {
  const dues = new ListShellPage(page, { titleKey: 'fees.dues.title' }, locale);
  await dues.expectLoaded();
  await dues.dataRows().first().getByRole('checkbox').check();
}

export const overlayOpeners: Record<string, (page: Page, locale: Locale) => Promise<void>> = {
  '/fees/dues::send-reminder': async (page, locale) => {
    await selectFirstDuesRow(page, locale);
    await page.getByRole('button', { name: makeT(locale)('fees.dues.sendReminder') }).click();
    await expectDialogOpen(page);
  },
  '/fees/dues::generate-invoices': async (page, locale) => {
    await selectFirstDuesRow(page, locale);
    await page.getByRole('button', { name: makeT(locale)('fees.dues.generateInvoice') }).click();
    await expectDialogOpen(page);
  },
  '/students::send-reminder': async (page, locale) => {
    const list = new ListShellPage(page, { titleKey: 'students.list.title' }, locale);
    await list.expectLoaded();
    await list.dataRows().first().getByRole('checkbox').check();
    await page.getByRole('button', { name: makeT(locale)('students.list.sendReminder') }).click();
    await expectDialogOpen(page);
  },
  // Only the create state is declared for this route. `edit-structure` and
  // `delete-structure` both need an existing row, which the a11y suite
  // doesn't seed for `/fee-structures` — and the edit dialog is the same
  // `StructureFormDialog` component this opens, so the form's composition
  // is covered either way. The delete confirm is the gap; seeding a
  // structure here would close it.
  '/fee-structures::create-structure': async (page, locale) => {
    const list = new ListShellPage(page, { titleKey: 'feeStructures.list.title' }, locale);
    await list.expectLoaded();
    await page
      .getByRole('button', { name: makeT(locale)('feeStructures.list.addStructure') })
      .click();
    await expectDialogOpen(page);
  },
  '/students/$studentId::send-reminder': async (page, locale) => {
    await new DetailShellPage(page, locale).clickAction('students.detail.actions.sendReminder');
    await expectDialogOpen(page);
  },
  '/students/$studentId::delete-student': async (page, locale) => {
    await new DetailShellPage(page, locale).clickAction('students.detail.actions.delete');
    await expectDialogOpen(page);
  },
  '/students/$studentId::transfer-status': async (page, locale) => {
    await new DetailShellPage(page, locale).clickAction('students.detail.actions.transferStatus');
    await expectDialogOpen(page);
  },
};
