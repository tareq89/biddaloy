import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { expectReachableInMain, openFromSidebar } from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

test.describe('Reports (accountant)', () => {
  test.use(loggedIn('accountant'));

  test('collections report', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.collectionsReport'));
    await expectReachableInMain(page);
  });
});
