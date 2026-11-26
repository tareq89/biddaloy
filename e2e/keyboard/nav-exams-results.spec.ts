import { adminApiSession, submitMarkSheet } from '../api';
import { marksImportScene } from '../fixtures/marks-import';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  expectPrimaryTaskOpensAndCloses,
  expectReachableInMain,
  modalTitled,
  openFromSidebar,
} from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.
test.describe('Exams & Results (admin)', () => {
  test.use(loggedIn('admin'));
  // The journey budgets (30s per assert) need more than the 30s default test timeout.
  test.setTimeout(120_000);

  test('exams', async ({ page }) => {
    await openFromSidebar(page, t('common.entities.exam_other'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('exams.list.addExam'),
      modalTitled(page, t('exams.examForm.createTitle')),
    );
  });

  test('seat plans', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.seatPlans'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('seatPlans.list.generateButton'),
      modalTitled(page, t('seatPlans.generate.title')),
    );
  });

  test('promotions', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.promotion'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('promotions.list.newRun'),
      modalTitled(page, t('promotions.newRunForm.title')),
    );
  });

  test('marks entry', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.marksEntry'));
    await expectReachableInMain(page);
  });

  test('results', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.results'));
    await expectReachableInMain(page);
  });

  test('final results', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.finalResults'));
    await expectReachableInMain(page);
  });

  // [80.3.03] D14: a SUBMITTED grid -> Ctrl+K -> "Send marks SMS" -> the review page -> Esc back.
  // The scene's students have no guardian, so the review reads "nobody is left"; the send itself
  // is covered by the component test and the server e2e.
  test('marks SMS', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const scene = await marksImportScene(request, session, 1);
    await submitMarkSheet(request, session, scene.examId, {
      section_id: scene.sectionId,
      subject_id: scene.subjectId,
    });

    await page.goto(scene.gridPath);
    await expect(page.getByRole('heading', { name: t('exams.marksGrid.caption') })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3');
    await page.keyboard.type('নম্বরের এসএমএস');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sms$/);
    await expect(page.getByRole('heading', { level: 1, name: t('marksSms.title') })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(new RegExp(`${scene.subjectId}$`));
  });
});
