import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { expectReachableInMain, openFromSidebar } from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.
// Nothing here sends a message.

test.describe('Communications (admin)', () => {
  test.use(loggedIn('admin'));

  test('send message', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.sendMessage'));
    await expectReachableInMain(page);
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
