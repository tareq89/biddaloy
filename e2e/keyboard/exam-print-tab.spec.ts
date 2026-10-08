import { adminApiSession, seededFirstTermExamId } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [48.4.03] Exam Print tab and the code-rendered document page, KEYBOARD ONLY: the palette
 * lands on `?tab=print`, Tab reaches the admit-card button, Enter on "Print seat list" opens
 * `/print/document`, Tab reaches Print then Close, and Close returns to the exam. No `.click(`
 * and no `page.mouse` reaches the surfaces under test.
 *
 * Runs on the demo school's seeded "First Term Exam" (a published seat plan and a schedule),
 * the same data `e2e/journeys/wave3-documents.spec.ts` uses.
 */

test.use(loggedIn('admin'));

test('keyboard-only: palette -> Print tab -> seat list -> Print and Close', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const examId = await seededFirstTermExamId(request, session);

  await page.addInitScript(() => {
    window.print = () => undefined;
  });

  await page.goto(`/exams/${examId}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('Ctrl+K, the Action tab, "Print admit cards" lands on the Print tab', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3');
    // The palette label is en/bn data in `action-registry.ts`, not an i18n key.
    await page.keyboard.type('প্রবেশপত্র প্রিন্ট');
    const target = page.getByRole('option', { name: /প্রবেশপত্র প্রিন্ট/ });
    await expect(target).toBeVisible();
    // Nothing is active until the first ArrowDown (activeIndex starts at -1): make sure it is
    // the target that became active, not whatever happens to be first, before Enter.
    await page.keyboard.press('ArrowDown');
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=print/);
    await expect(
      page.getByRole('heading', { name: t('examDocuments.phase.before') }),
    ).toBeVisible();
  });

  await test.step('Tab reaches the admit-card button', async () => {
    await tabUntilFocused(page, t('examDocuments.admitCard.action'), 120);
  });

  await test.step('Enter on "Print seat list" opens the document page', async () => {
    await tabUntilFocused(page, t('examDocuments.seatList.action'), 40);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/print\/document\?.*doc=seat-list/);
    await expect(
      page.getByRole('heading', { name: t('examDocuments.seatList.title') }).first(),
    ).toBeVisible();
  });

  await test.step('Tab reaches Print and Close; Enter on Close returns to the exam', async () => {
    // A disabled button is not focusable: wait until the document has rendered.
    await expect(
      page.getByRole('button', { name: t('examDocuments.page.print'), exact: true }),
    ).toBeEnabled();
    await tabUntilFocused(page, t('examDocuments.page.print'), 30, { tag: 'BUTTON' });
    // Close sits before Print in the page header, so walk back to it.
    await tabUntilFocused(page, t('examDocuments.page.close'), 5, { tag: 'BUTTON', shift: true });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/exams/${examId}`));
    await expect(
      page.getByRole('heading', { name: t('examDocuments.phase.before') }),
    ).toBeVisible();
  });
});
