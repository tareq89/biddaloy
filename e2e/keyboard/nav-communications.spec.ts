import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  expectPrimaryTaskOpensAndCloses,
  expectReachableInMain,
  modalTitled,
  openFromSidebar,
  tabToLocator,
  tabUntilFocused,
} from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.
// Nothing here sends a message (the staff journey stops at the check, before Send).

test.describe('Communications (admin)', () => {
  test.use(loggedIn('admin'));

  test('send message', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.sendMessage'));
    await expectReachableInMain(page);
  });

  // [80.2.02] Sidebar -> Send message -> Staff tab (arrow key) -> type -> check, no mouse. It stops at
  // "Check who gets it": the check writes nothing, and Send would spend the school's SMS credits.
  test('message staff', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.sendMessage'));
    await tabUntilFocused(page, t('staffMessage.switch.guardians'), 30, { exact: true });
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByRole('heading', { level: 1, name: t('staffMessage.title') }),
    ).toBeVisible();
    await tabToLocator(page, page.getByRole('textbox', { name: t('staffMessage.message.label') }));
    await page.keyboard.type('Staff meeting at 3 pm');
    await tabToLocator(
      page,
      page.getByRole('button', { name: t('staffMessage.preview.action'), exact: true }),
    );
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: t('staffMessage.send.action'), exact: true }),
    ).toBeVisible();
  });

  // [97.4.03] Opening the log reads only; nothing is sent.
  test('message log', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.messageLog'));
    await expectReachableInMain(page);
  });

  // [53.4] The notice list opens from the sidebar; "Give a notice" is a link that opens the full-page
  // composer, Escape closes it. Opening it saves nothing (the draft is created on the first Next).
  test('notices', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.notices'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('notices.manage.give'),
      modalTitled(page, t('noticeCompose.title')),
      'A',
    );
  });

  // [67.6.02] Send an alert opens as a full-page dialog, so focus lands inside it (on its close
  // button), not on the h1 `openFromSidebar` waits for. Opening the page sends nothing.
  test('send an alert', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await tabUntilFocused(page, t('nav.items.sendAlert'), 150, { tag: 'a', exact: true });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', { level: 1, name: t('nav.items.sendAlert'), exact: true }),
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);
  });
});

test.describe('Communications (accountant)', () => {
  test.use(loggedIn('accountant'));

  test('fee reminders', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.feeReminders'));
    await expectReachableInMain(page);
  });

  test('reminder history', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.reminderHistory'));
    await expectReachableInMain(page);
  });
});
