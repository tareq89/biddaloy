import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  expectPrimaryTaskOpensAndCloses,
  expectReachableInMain,
  modalTitled,
  openFromSidebar,
} from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

test.describe('People (admin)', () => {
  test.use(loggedIn('admin'));

  test('guardians', async ({ page }) => {
    await openFromSidebar(page, t('common.entities.guardian_other'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('guardians.invite.trigger'),
      modalTitled(page, t('guardians.invite.title')),
    );
  });

  test('calendar', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.calendar'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('calendar.page.addEvent'),
      modalTitled(page, t('calendar.eventForm.createTitle')),
    );
  });

  test('admission intakes', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.admissionIntakes'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('admission-staff-intakes.list.addIntake'),
      modalTitled(page, t('admission-staff-intakes.createDialog.title')),
    );
  });

  test('admission applicants', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.admissionApplicants'));
    await expectReachableInMain(page);
  });
});
