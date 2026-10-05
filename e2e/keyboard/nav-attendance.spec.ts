import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { expectReachableInMain, openFromSidebar } from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

test.describe('Attendance (admin)', () => {
  test.use(loggedIn('admin'));

  test('attendance reports', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.attendanceReports'));
    await expectReachableInMain(page);
  });

  test('attendance register', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.attendanceRegister'));
    await expectReachableInMain(page);
  });

  test('staff attendance', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.staffAttendance'));
    await expectReachableInMain(page);
  });
});
