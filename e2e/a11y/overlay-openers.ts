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
  const dialog = page.getByRole('dialog').or(page.getByRole('alertdialog'));
  await expect(dialog).toBeVisible();
  // `role="dialog"` resolves to `DialogContent` (`ui/src/primitives/
  // dialog.tsx`), which itself carries the open transition
  // (`fade-in-0 zoom-in-95`, 240ms — contract §7). `toBeVisible()` passes
  // as soon as the element mounts, while that transition is still
  // animating its own opacity — an axe scan that lands mid-fade blends
  // every descendant's rendered colour with whatever is behind the
  // dialog, producing a different (and often wrongly failing)
  // color-contrast reading each run. Wait for the dialog's own
  // animations to finish before scanning.
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
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
  // [8.11.9] Send Message's confirm dialog — the page's review step. The
  // form's three required fields must be filled first or the submit is
  // blocked by native validation and no dialog opens.
  '/communications/send::confirm-send': async (page, locale) => {
    const t = makeT(locale);
    await page.getByLabel(t('communications.send.recipientNameLabel')).fill('Rahima Begum');
    await page.getByLabel(t('communications.send.recipientAddressLabel')).fill('+8801700000001');
    await page.getByLabel(t('communications.send.messageLabel')).fill('School closed tomorrow.');
    await page.getByRole('button', { name: t('communications.send.submit') }).click();
    await expectDialogOpen(page);
  },
  '/students/$studentId::delete-student': async (page, locale) => {
    await new DetailShellPage(page, locale).clickAction('students.detail.actions.delete');
    await expectDialogOpen(page);
  },
  // [13.7.1] The trial bar's details dialog. The seeded admin's school is not
  // in a trial, so the onboarding status is patched on the way in to look like
  // one (4 of 10 students, a support link so the contact button is scanned too).
  '/dashboard::trial-details': async (page, locale) => {
    await page.route('**/api/v1/onboarding/status', async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as object;
      await route.fulfill({
        response,
        json: {
          ...body,
          trial: {
            ends_at: new Date(Date.now() + 23 * 86_400_000).toISOString(),
            days_left: 23,
            seats: { used: 4, limit: 10 },
          },
          support_url: 'https://example.com/help',
        },
      });
    });
    await page.reload();
    await page.getByRole('button', { name: makeT(locale)('trial.details.open') }).click();
    await expectDialogOpen(page);
  },
  // `$schoolId` resolves to the seeded trial school (`responsive/routes.ts`),
  // the only seeded school whose page has a trial card.
  '/schools/$schoolId::extend-trial': async (page, locale) => {
    await page
      .getByRole('button', { name: makeT(locale)('platform.trial.card.extendAction') })
      .click();
    await expectDialogOpen(page);
  },
  '/security::leave-school': async (page, locale) => {
    await page.getByRole('button', { name: makeT(locale)('signInMethods.leave.title') }).click();
    await expectDialogOpen(page);
  },
  // Needs a former member: `routes.a11y.spec.ts` leaves one behind first.
  '/staff::restore-member': async (page, locale) => {
    await page.goto('/staff?membership=former');
    const list = new ListShellPage(page, { titleKey: 'staff.list.title' }, locale);
    await list.expectLoaded();
    await list.clickRowAction('', 'staff.former.bringBack');
    await expectDialogOpen(page);
  },
  // [30.4.1] `ShortcutsSheet` (`ui/src/components/shortcuts-sheet.tsx`) —
  // the `?` keyboard-shortcuts help. It is global, not tied to any one
  // route, so it is deliberately NOT in `route-manifest.json` — that file
  // only lists navigable routes, and this dialog has no URL.
  '$global::shortcuts-sheet': async (page) => {
    await page.keyboard.press('?');
    await expectDialogOpen(page);
  },
  // [30.5.1] `CommandPalette` itself — same "global, no URL" reasoning as
  // the shortcuts sheet above. Wired into the axe sweep alongside it now
  // that `command-palette-launcher.tsx` mounts both behind global
  // listeners (`e2e/a11y/routes.a11y.spec.ts`'s `$global` sweep).
  '$global::command-palette': async (page) => {
    await page.keyboard.press('ControlOrMeta+k');
    await expectDialogOpen(page);
  },
};

/** Keys in `overlayOpeners` that open a route-agnostic overlay rather
 * than one scoped to a manifest route — swept separately by
 * `routes.a11y.spec.ts`'s `$global` sweep. */
export const GLOBAL_OVERLAY_KEYS = Object.keys(overlayOpeners).filter((key) =>
  key.startsWith('$global::'),
);
