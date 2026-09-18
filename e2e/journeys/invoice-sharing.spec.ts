import { adminApiSession, createInvoice, createStudentWithDues } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [16.5.6] Journey: from an invoice's detail page — Print (POS-80,
 * server-rendered), Copy link → open in a fresh, unauthenticated context
 * (public receipt), then Revoke from the admin side and confirm the same
 * link 404s.
 *
 * No dedicated visual-baseline Playwright job exists in this repo yet
 * (checked: no `toHaveScreenshot`/visual-baseline harness under `e2e/` or
 * `.github/workflows/` at this branch's base) — the ticket's "follow the
 * existing pattern" note doesn't apply because there is no existing
 * pattern to follow here. Flagged for the parent rather than invented;
 * this journey covers the print/share/revoke behaviour functionally
 * instead (the `@page` CSS rule the print format actually emits is
 * already asserted byte-for-byte in
 * `server/src/modules/invoices/invoice-print-pos.template.spec.ts`).
 */

test.use(loggedIn('accountant'));

test('print, copy the share link, open it unauthenticated, then revoke it', async ({
  page,
  context,
  request,
}) => {
  const session = await adminApiSession(request);
  const name = `Invoice Share Student ${Date.now()}`;
  const { studentId } = await createStudentWithDues(request, session, name);
  const invoice = await createInvoice(request, session, studentId);

  await page.goto(`/invoices/${invoice.id}`);
  await expect(page.getByText(t('fees.invoiceDetail.totalAmount')).first()).toBeVisible();

  await test.step('Print opens the POS-80 printable route', async () => {
    await page.getByRole('radio', { name: t('fees.invoiceDetail.printFormat.pos80') }).click();
    const [printPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByRole('button', { name: t('fees.invoiceDetail.print') }).click(),
    ]);
    // `openPrintableInvoice` (`ui/src/hooks/invoices.ts`) opens the tab on
    // `about:blank` first, then fetches the printable HTML and only sets
    // `printWindow.location.href` to a `blob:` URL once that GET resolves
    // — `waitForLoadState()` right after the tab opens resolves against
    // the still-blank initial document, before that navigation happens.
    await printPage.waitForURL((url) => url.protocol === 'blob:');
    await printPage.waitForLoadState();
    // Not `CSSPageRule.cssText`: Chromium's CSSOM doesn't round-trip the
    // `size` descriptor back out through `cssText` (confirmed live — the
    // raw server HTML has `@page { size: 80mm auto; margin: 2mm }`
    // byte-for-byte, per `invoice-print-pos.template.spec.ts`, but reading
    // it back via `CSSPageRule` drops `size` and leaves only `margin`).
    // The rendered document's own source is the real assertion surface.
    const html = await printPage.content();
    expect(html).toContain('80mm');
    await printPage.close();
  });

  let shareUrl = '';
  await test.step('Copy link creates a share and copies its URL', async () => {
    await page.getByRole('button', { name: t('fees.invoiceDetail.share.create') }).click();
    const copyButton = page.getByRole('button', { name: t('fees.invoiceDetail.share.copyLink') });
    await expect(copyButton).toBeVisible();
    // `input[value*="/i/"]` is a CSS *attribute* selector — React sets the
    // DOM `value` *property* on a controlled input, not the HTML
    // attribute, so this could never reliably match even once the URL
    // box actually rendered (biddaloy#823's plan). The input now has a
    // real accessible name (`fees.invoiceDetail.share.urlLabel`,
    // `$invoiceId.tsx`), so this reads it by label instead — the same
    // "rendered value, not the clipboard" reasoning still applies, to
    // avoid clipboard-read permission flakiness in CI.
    const urlInput = page.getByLabel(t('fees.invoiceDetail.share.urlLabel'));
    await expect(urlInput).toBeVisible();
    shareUrl = await urlInput.inputValue();
  });

  await test.step('the link is visible, unauthenticated, in a fresh context', async () => {
    const freshContext = await page.context().browser()!.newContext();
    const freshPage = await freshContext.newPage();
    const path = shareUrl.includes('/i/') ? shareUrl.slice(shareUrl.indexOf('/i/')) : shareUrl;
    await freshPage.goto(path);
    await expect(
      freshPage.getByText(t('fees.invoiceDetail.publicReceipt.billed')).first(),
    ).toBeVisible();
    await freshContext.close();
  });

  await test.step('Revoke, then the same link 404s', async () => {
    await page.getByRole('button', { name: t('fees.invoiceDetail.share.revoke') }).click();
    await page
      .getByRole('dialog', { name: t('fees.invoiceDetail.share.revokeConfirmTitle') })
      .getByRole('button', { name: t('fees.invoiceDetail.share.revoke') })
      .click();
    await expect(page.getByText(t('fees.invoiceDetail.share.revoked'))).toBeVisible();

    const freshContext = await page.context().browser()!.newContext();
    const freshPage = await freshContext.newPage();
    const path = shareUrl.includes('/i/') ? shareUrl.slice(shareUrl.indexOf('/i/')) : shareUrl;
    const response = await freshPage.goto(path);
    await expect(
      freshPage.getByText(t('fees.invoiceDetail.publicReceipt.notFoundExplanation')),
    ).toBeVisible();
    void response;
    await freshContext.close();
  });
});
