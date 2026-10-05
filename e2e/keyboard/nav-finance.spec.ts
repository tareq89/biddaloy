import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  expectPrimaryTaskOpensAndCloses,
  expectReachableInMain,
  modalTitled,
  openFromSidebar,
} from './keyboard-utils';

// [31.5.2] D36 — one keyboard journey per nav group; a new screen in this group adds one test here.

const recordPaymentTitle = t('payments.record.title');

test.describe('Finance (admin)', () => {
  test.use(loggedIn('admin'));

  test('fee structures', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.feeStructures'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('feeStructures.list.addStructure'),
      modalTitled(page, t('feeStructures.form.createTitle')),
    );
  });
});

test.describe('Finance (accountant)', () => {
  test.use(loggedIn('accountant'));

  test('student dues', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.studentDues'));
    await expectReachableInMain(page);
  });

  test('record payment', async ({ page }) => {
    // The record-payment full-page modal opens on arrival.
    await openFromSidebar(page, recordPaymentTitle);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { level: 1, name: recordPaymentTitle })).toBeHidden();
  });

  test('generate fees', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.generateFees'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('fees.generations.generateButton'),
      page.getByRole('dialog').first(),
    );
  });

  test('recurring schedules', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.recurringSchedules'));
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('fees.schedules.addSchedule'),
      modalTitled(page, t('fees.schedules.form.createTitle')),
    );
  });

  test('invoices', async ({ page }) => {
    await openFromSidebar(page, t('common.entities.invoice_other'));
    await expectReachableInMain(page);
  });

  test('payments', async ({ page }) => {
    await openFromSidebar(page, t('nav.items.payments'));
    // The header primary is a link to /payments/record.
    await expectPrimaryTaskOpensAndCloses(
      page,
      t('payments.recordAction'),
      page.getByRole('heading', { level: 1, name: recordPaymentTitle }),
      'BUTTON',
    );
    await expect(page).toHaveURL(/\/payments$/);
  });
});
