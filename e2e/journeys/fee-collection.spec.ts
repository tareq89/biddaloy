import { REGION_BD_BN } from '../../ui/src/i18n/region-config';
import { formatServerAmount } from '../../ui/src/utils/currency';
import { adminApiSession, createStudentWithDues } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { DetailShellPage } from '../pages/detail-shell';
import { RecordPaymentWizardPage } from '../pages/record-payment-wizard';

/**
 * [8.5.7] Journey 5: fee collection end to end (mouse path — the
 * keyboard-only path is [8.5.6]'s). Seeds its own student with an
 * outstanding ৳500 tuition fee, then drives the wizard: find →
 * outstanding → allocate (FIFO prefill) → method → confirm → receipt,
 * and checks the student's payments tab reflects it.
 */

test.use(loggedIn('accountant'));

test('record a full payment through the wizard', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const name = `Fee Payer ${Date.now()}`;
  const { studentId } = await createStudentWithDues(request, session, name, { amount: 500 });

  const wizard = new RecordPaymentWizardPage(page);

  await test.step('find the student', async () => {
    await page.goto('/payments/record');
    await wizard.expectStep('payments.record.steps.findStudent');
    await page.getByLabel(t('payments.record.findStudent.searchLabel')).fill(name);
    await page.getByRole('button', { name }).click();
  });

  await test.step('outstanding fees are visible; enter the amount received', async () => {
    await wizard.expectOutstandingFees();
    await page.getByLabel(t('payments.record.outstandingFees.amountReceivedLabel')).fill('500');
    await wizard.next();
  });

  await test.step('allocation is prefilled FIFO', async () => {
    await wizard.expectAllocateStep();
    await wizard.next();
  });

  await test.step('method defaults are fine', async () => {
    await wizard.expectMethodStep();
    await wizard.next();
  });

  await test.step('confirm and get the receipt', async () => {
    await wizard.confirm();
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('payments.record.receipt.printAction') }),
    ).toBeVisible();
  });

  await test.step("the student's payments tab reflects the payment", async () => {
    const detail = new DetailShellPage(page);
    await page.goto(`/students/${studentId}`);
    await detail.expectLoaded(name);
    await detail.openTab('students.detail.tabs.payments', 'payments');
    await expect(
      page.getByRole('cell', { name: formatServerAmount(500, REGION_BD_BN) }),
    ).toBeVisible();
  });
});

test('partial payment allocates less than the balance', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const name = `Partial Payer ${Date.now()}`;
  const { studentId } = await createStudentWithDues(request, session, name, { amount: 500 });

  const wizard = new RecordPaymentWizardPage(page);
  await page.goto('/payments/record');
  await page.getByLabel(t('payments.record.findStudent.searchLabel')).fill(name);
  await page.getByRole('button', { name }).click();

  await wizard.expectOutstandingFees();
  await page.getByLabel(t('payments.record.outstandingFees.amountReceivedLabel')).fill('200');
  await wizard.next();
  await wizard.expectAllocateStep();
  await wizard.next();
  await wizard.expectMethodStep();
  await wizard.next();
  await wizard.confirm();
  await expect(
    page.getByRole('button', { name: t('payments.record.receipt.printAction') }),
  ).toBeVisible();

  await test.step('the ৳200 payment is recorded and ৳300 remains outstanding', async () => {
    const detail = new DetailShellPage(page);
    await page.goto(`/students/${studentId}`);
    await detail.expectLoaded(name);

    await detail.openTab('students.detail.tabs.payments', 'payments');
    await expect(
      page.getByRole('cell', { name: formatServerAmount(200, REGION_BD_BN) }),
    ).toBeVisible();

    await detail.openTab('students.detail.tabs.fees', 'fees');
    await expect(
      page.getByText(formatServerAmount(300, REGION_BD_BN), { exact: true }),
    ).toBeVisible();
  });
});
