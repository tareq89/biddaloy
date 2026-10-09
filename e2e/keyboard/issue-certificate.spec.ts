import type { Page } from '@playwright/test';

import { adminApiSession, createStudent, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [48.4.03] Student > Documents > "Issue certificate" (the D13 path), KEYBOARD ONLY: arrow keys
 * in the tab list, Tab to the button, the modal's four steps (kind, details, preview, print),
 * the printer select, Print, "Did all print?", the result view, Esc back to the button. No
 * `.click(` and no `page.mouse` reaches the surfaces under test.
 *
 * `window.open` is stubbed: a real print window cannot be driven.
 */

test.use(loggedIn('admin'));

/** The printer this spec adds is archived afterwards so it does not pile up in every picker. The
 * student stays: it now holds an issued certificate in the register. */
let printerId: string | undefined;
test.afterAll(async ({ request }) => {
  if (printerId)
    await post(request, await adminApiSession(request), `/printers/${printerId}/archive`, {});
});

/** Arrow keys until the radio named `name` has focus, then Space checks it. */
async function arrowToRadio(page: Page, name: string) {
  const radio = page.getByRole('radio', { name });
  for (let i = 0; i < 8; i += 1) {
    if ((await radio.getAttribute('aria-checked')) === 'true') return;
    if (await radio.evaluate((el) => el === document.activeElement)) {
      await page.keyboard.press('Space');
    } else {
      await page.keyboard.press('ArrowRight');
    }
  }
  await expect(radio).toBeChecked();
}

/** Tab until focus sits on an element with `role`. */
async function tabToRole(page: Page, role: string, max = 40) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    const got = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? '');
    if (got === role) return;
  }
  throw new Error(`could not reach role "${role}" within ${max} Tab presses`);
}

test('keyboard-only: issue a testimonial from the Documents tab to the result view', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const name = `Kb Certificate ${Date.now()}`;
  const student = await createStudent(request, session, name);
  const printerName = `Kb Cert Printer ${Date.now()}`;
  ({ id: printerId } = await post<{ id: string }>(request, session, '/printers', {
    name: printerName,
    printer_type: 'OFFICE',
    // An A4 certificate fills the sheet: no margin, no gap.
    margin_top_mm: 0,
    margin_right_mm: 0,
    margin_bottom_mm: 0,
    margin_left_mm: 0,
  }));

  await page.addInitScript(() => {
    window.open = (() => ({
      opener: null,
      location: { href: '' },
      print: () => undefined,
      close: () => undefined,
    })) as unknown as typeof window.open;
  });

  await page.goto(`/students/${student.id}`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('arrow keys in the tab list reach Documents', async () => {
    const documents = page.getByRole('tab', { name: t('students.detail.tabs.documents') });
    // Tabs follow permissions that load after the page: wait for the last two to exist.
    await expect(documents).toBeVisible();
    await expect(page.getByRole('tab', { name: t('students.detail.tabs.activity') })).toBeVisible();
    const selected = page.getByRole('tab', { selected: true });
    await selected.focus();
    // Arrow keys move focus AND select the tab. Documents sits second to last (Activity is
    // last), so End then ArrowLeft is the short way along a strip with this many tabs.
    const activity = page.getByRole('tab', { name: t('students.detail.tabs.activity') });
    await page.keyboard.press('End');
    await expect(activity).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(documents).toHaveAttribute('aria-selected', 'true');
  });

  await test.step('Tab to "Issue certificate" and open it with Enter', async () => {
    await tabUntilFocused(page, t('certificates.documentsTab.issue'), 40, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: t('certificates.kind.label') })).toBeVisible();
    // Focus moved into the modal (the step heading), not left on the page behind it.
    await expect(async () => {
      const inside = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(inside).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  await test.step('arrow keys pick Testimonial; the disabled TC is skipped', async () => {
    await tabToRole(page, 'radio');
    await arrowToRadio(page, t('printHistory.kind.TESTIMONIAL'));
    await expect(
      page.getByRole('radio', { name: t('printHistory.kind.TRANSFER_CERTIFICATE') }),
    ).toBeDisabled();
    await tabUntilFocused(page, t('certificates.actions.next'), 20, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: t('certificates.language.title') }),
    ).toBeVisible();
  });

  await test.step('the language card, then the typed details', async () => {
    await tabToRole(page, 'radio');
    // The school default is already chosen; an arrow key keeps a radio group usable.
    await expect(page.getByRole('radio', { checked: true }).first()).toBeVisible();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        await page.keyboard.type('Good conduct throughout');
        break;
      }
    }
  });

  await test.step('Next (preview), Next (print)', async () => {
    await tabUntilFocused(page, t('certificates.actions.preview'), 30, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    const next = page.getByRole('button', { name: t('certificates.actions.next'), exact: true });
    await expect(next).toBeEnabled();
    await tabUntilFocused(page, t('certificates.actions.next'), 30, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: t('certificates.steps.print') }).first(),
    ).toBeVisible();
  });

  await test.step('the printer select by keyboard, then Print', async () => {
    await tabUntilFocused(page, t('certificates.printer.label'), 30, { tag: 'BUTTON' });
    // The option's accessible name carries more than the printer name, so match by pattern.
    await page.keyboard.press('Enter');
    await page.keyboard.type(printerName);
    const option = page.getByRole('option', { name: new RegExp(printerName) });
    await expect(option).toBeVisible();
    await option.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeHidden();
    await tabUntilFocused(page, t('certificates.actions.print'), 30, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
  });

  await test.step('"Did all print?": Enter on Yes, then the result view', async () => {
    const yes = page.getByRole('button', { name: t('printPreview.confirm.yes') });
    await expect(yes).toBeVisible();
    await yes.focus();
    await page.keyboard.press('Enter');
    // The answer is recorded; Continue leaves the dialog for the result view.
    const next = page.getByRole('button', { name: t('printPreview.confirm.continue') });
    await expect(next).toBeVisible();
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status').filter({ hasText: /TSM-/ })).toBeVisible();
  });

  await test.step('Esc closes the modal and focus returns to "Issue certificate"', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(
      page.getByRole('button', { name: t('certificates.documentsTab.issue') }),
    ).toBeFocused();
  });
});
