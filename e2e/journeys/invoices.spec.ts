import { adminApiSession, createInvoice, createStudentWithDues } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ListShellPage } from '../pages/list-shell';

/**
 * [8.5.7] Journey 7: an issued invoice shows on `/invoices` and its
 * detail page renders.
 *
 * [16.5.1] The dues queue's bulk "Generate invoice" dialog this journey
 * used to drive was removed — an invoice can only be minted from a real
 * payment now (D2/D18), there's no more arbitrary-line-item invoice for
 * outstanding dues. Record Payment (the UI flow that now mints invoices)
 * has no dedicated e2e journey of its own yet, so this issues the invoice
 * via the same real checkout endpoint that flow drives, and keeps this
 * journey's own focus on what it's actually named for: the invoice
 * list/detail read side.
 */

test.use(loggedIn('accountant'));

test('an issued invoice shows on /invoices and its detail renders', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const name = `Invoice Student ${Date.now()}`;
  const { studentId } = await createStudentWithDues(request, session, name);
  await createInvoice(request, session, studentId);

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
