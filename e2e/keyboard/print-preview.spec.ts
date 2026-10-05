import { adminApiSession, createStudent, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [32.4.5] Print preview, KEYBOARD ONLY: open "Print student ID card" from the palette,
 * pick one student in the modal, land on the preview, choose a printer, print, and answer
 * "did all print?". No `.click(` and no `page.mouse`.
 *
 * `window.open` is stubbed: a real print window cannot be driven, and the preview's
 * only contract with it is "open, then load the blob".
 */

test.use(loggedIn('admin'));

test('keyboard-only: palette -> pick a student -> preview -> print -> all printed', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const name = `Kb Preview ${Date.now()}`;
  await createStudent(request, session, name);
  const printerName = `Kb Printer ${Date.now()}`;
  await post(request, session, '/printers', { name: printerName, printer_type: 'CARD' });

  await page.addInitScript(() => {
    window.open = (() => ({
      opener: null,
      location: { href: '' },
      print: () => undefined,
      close: () => undefined,
    })) as unknown as typeof window.open;
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('Ctrl+K, the Action tab, "Print student ID card"', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3');
    // The palette label is en/bn data in `action-registry.ts`, not an i18n key.
    await page.keyboard.type('শিক্ষার্থীর আইডি কার্ড');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 1, name: t('printPreview.picker.title') }),
    ).toBeVisible();
  });

  await test.step('search for the student, tick them, continue', async () => {
    await tabUntilFocused(page, t('printPreview.picker.search'), 10, { tag: 'INPUT' });
    await page.keyboard.type(name);
    await expect(page.getByLabel(name)).toBeVisible();
    await page.getByLabel(name).focus();
    await page.keyboard.press('Space');
    const go = page.getByRole('button', {
      name: t('printPreview.picker.continue_one', { count: 1 }),
    });
    await go.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('printPreview.title') })).toBeVisible();
  });

  await test.step('one card is shown; choose the printer', async () => {
    await expect(
      page.getByText(t('printPreview.header.batch', { current: 1, total: 1, count: 1 })),
    ).toBeVisible();
    const printer = page.getByRole('combobox', { name: t('printPreview.controls.printer') });
    await printer.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type(printerName);
    const option = page.getByRole('option', { name: new RegExp(printerName) });
    await expect(option).toBeVisible();
    await option.focus();
    await page.keyboard.press('Enter');
  });

  await test.step('print by keyboard and answer "yes, all printed"', async () => {
    // No photo -> the preview asks for an explicit "print anyway".
    const anyway = page.getByRole('checkbox', { name: t('printPreview.preflight.printAnyway') });
    await anyway.focus();
    await page.keyboard.press('Space');
    await expect(anyway).toBeChecked();
    const print = page.getByRole('button', { name: t('printPreview.print'), exact: true });
    await print.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const yes = dialog.getByRole('button', { name: t('printPreview.confirm.yes') });
    await yes.focus();
    await page.keyboard.press('Enter');

    // The answer is recorded; "Continue" leaves the preview (the last batch is done).
    await expect(dialog.getByText(t('printPreview.confirm.recorded'))).toBeVisible();
    const next = dialog.getByRole('button', { name: t('printPreview.confirm.continue') });
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page).not.toHaveURL(/\/print\/preview/);
  });
});
