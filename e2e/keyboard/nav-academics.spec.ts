import { loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  expectPrimaryTaskOpensAndCloses,
  expectReachableInMain,
  modalTitled,
  openFromSidebar,
} from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

test.describe('Academics (admin)', () => {
  test.use(loggedIn('admin'));

  test('academic years', async ({ page }) => {
    await openFromSidebar(page, t('common.entities.academicYear_other'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('academicYears.list.addYear'),
      modalTitled(page, t('academicYears.form.createTitle')),
    );
  });

  test('routine setup', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.routineSetup'));
    await expectReachableInMain(page);
  });

  test('routine builder', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.routineBuilder'));
    await expectReachableInMain(page);
  });

  test('my routine', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.myRoutine'));
    await expectReachableInMain(page);
  });

  test('routine review', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.routineReview'));
    await expectReachableInMain(page);
  });

  test('routine substitutions', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.routineSubstitutions'));
    // The add action is the page's PageHeader primary.
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('routines.substitutionsPage.addAction'),
      page.getByRole('dialog').first(),
    );
  });
});
