import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { expectReachableInMain, openFromSidebar } from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

test.describe('Administration (admin)', () => {
  test.use(loggedIn('admin'));

  test('roles and access', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.rolesAccess'));
    await expectReachableInMain(page);
  });

  test('audit logs', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.auditLogs'));
    await expectReachableInMain(page);
  });
});
