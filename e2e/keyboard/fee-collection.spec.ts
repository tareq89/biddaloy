import { adminApiSession, createStudentWithDues } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [8.5.6] Fee collection end to end, KEYBOARD ONLY. This file contains
 * no `page.mouse` and no `.click(` call — grep it. Navigation is
 * exclusively Tab / Shift+Tab / Enter / Space / Arrows. The mouse path
 * of the same journey is `e2e/journeys/fee-collection.spec.ts`.
 */

test.use(loggedIn('accountant'));

test('accountant records a payment without touching the mouse', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const name = `Keyboard Payer ${Date.now()}`;
  await createStudentWithDues(request, session, name, { amount: 500 });

  await test.step('skip link, then keyboard-navigate to record payment', async () => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // Reset the tab cursor to the top of the document (route focus has
    // already moved focus to the page heading).
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t('nav.skipToContent') })).toBeFocused();
    await tabUntilFocused(page, t('nav.items.recordPayment'));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('payments.record.title') })).toBeVisible();
  });

  await test.step('find the student', async () => {
    await tabUntilFocused(page, t('payments.record.findStudent.searchLabel'));
    await page.keyboard.type(name);
    await expect(page.getByRole('button', { name })).toBeVisible();
    await tabUntilFocused(page, name, 10);
    await page.keyboard.press('Enter');
  });

  await test.step('enter the amount received', async () => {
    await tabUntilFocused(page, t('payments.record.outstandingFees.amountReceivedLabel'));
    await page.keyboard.type('500');
    await tabUntilFocused(page, 'Next', 20);
    await page.keyboard.press('Enter');
  });

  await test.step('allocation (FIFO prefill) forward', async () => {
    await expect(page.locator('[aria-current="step"]')).toContainText(
      t('payments.record.steps.allocate'),
    );
    await tabUntilFocused(page, 'Next', 30);
    await page.keyboard.press('Enter');
  });

  await test.step('method forward', async () => {
    await expect(page.locator('[aria-current="step"]')).toContainText(
      t('payments.record.steps.method'),
    );
    await tabUntilFocused(page, 'Next', 30);
    await page.keyboard.press('Enter');
  });

  await test.step('confirm and reach the receipt', async () => {
    await expect(page.locator('[aria-current="step"]')).toContainText(
      t('payments.record.steps.confirm'),
    );
    await tabUntilFocused(page, t('payments.record.confirm.submitAction'), 40, { tag: 'button' });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('button', { name: t('payments.record.receipt.printAction') }),
    ).toBeVisible();
  });
});
