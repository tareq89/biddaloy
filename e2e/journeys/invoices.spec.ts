import { adminApiSession, createStudentWithDues } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ListShellPage } from '../pages/list-shell';

/**
 * [8.5.7] Journey 7: invoice generation from the dues queue (the
 * generate-invoice dialog lives on `/fees/dues` — `/fees` itself is
 * still a placeholder) and the invoice detail page.
 */

test.use(loggedIn('accountant'));

test('generate an invoice from dues and open its detail', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const name = `Invoice Student ${Date.now()}`;
  const { chain } = await createStudentWithDues(request, session, name);

  const dues = new ListShellPage(page, { titleKey: 'fees.dues.title' });

  await test.step('select the row and run the generate-invoice dialog', async () => {
    await page.goto(`/fees/dues?class_id=${chain.classId}`);
    await dues.expectLoaded();
    await dues.row(name).first().getByRole('checkbox').check();
    await page.getByRole('button', { name: t('fees.dues.generateInvoice') }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t('fees.dues.generateInvoiceDialog.confirm') })
      .click();
    await expect(
      page.getByText(t('fees.dues.generateInvoiceDialog.successMessage_one', { count: 1 })),
    ).toBeVisible();
  });

  await test.step('the invoice shows on /invoices and its detail renders', async () => {
    const invoices = new ListShellPage(page, {
      titleKey: 'fees.invoices.title',
      searchLabelKey: 'fees.invoices.searchLabel',
    });
    await page.goto('/invoices');
    await invoices.expectLoaded();
    await invoices.search(name);
    await invoices.expectResultCount(1);
    await invoices.openRowByText(name);
    await expect(page.getByText(t('fees.invoiceDetail.totalAmount')).first()).toBeVisible();
  });
});
