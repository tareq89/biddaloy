import { adminApiSession, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [48.4.03] Reports > Printables: the Certificate register and the To print tab, KEYBOARD ONLY.
 * The palette opens the register, a serial typed into the search narrows the rows (and the live
 * region says so), a row's View opens its dialog and Esc closes it, arrow keys move to the To
 * print tab, and Enter on a group's print link opens `/print/preview`. No `.click(` and no
 * `page.mouse` reaches the surfaces under test.
 *
 * Runs on the demo school's seeded register (`ensureDocumentsSeed`), the same data
 * `e2e/journeys/wave3-documents.spec.ts` uses. The Settings > Printing > Documents card is
 * covered by the existing settings keyboard journey, so it has no case of its own here.
 */

test.use(loggedIn('admin'));

interface RegisterRow {
  serial: string | null;
  document_kind: string;
  revoked_at: string | null;
}

test('keyboard-only: register search, row details, then the To print tab', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const register = await get<{ data: RegisterRow[] }>(request, session, '/print-history/register');
  const serial = register.data.find((r) => r.serial && !r.revoked_at)?.serial;
  if (!serial) throw new Error('No seeded certificate serial — has `yarn seed` run?');

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('Ctrl+K, the Action tab, "Certificate register" opens the register', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3');
    // The palette label is en/bn data in `action-registry.ts`, not an i18n key.
    await page.keyboard.type('সনদ রেজিস্টার');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=register/);
    await expect(page.getByRole('heading', { name: t('printHistory.title') })).toBeVisible();
  });

  await test.step('type the serial into the search: the rows narrow to it', async () => {
    await tabUntilFocused(page, t('printHistory.filters.search'), 90, { tag: 'INPUT' });
    // Type once: the search box must keep every keystroke while its own URL commit round-trips.
    await page.keyboard.type(serial);
    await expect(page.getByRole('textbox', { name: t('printHistory.filters.search') })).toHaveValue(
      serial,
    );
    await expect(page.getByRole('cell', { name: serial }).first()).toBeVisible();
    // The result count is announced through a polite live region, not only shown.
    await expect(
      page.locator('[aria-live="polite"]').filter({ hasText: /\S/ }).first(),
    ).toBeAttached();
  });

  await test.step("open the row's View with Enter, then close it with Esc", async () => {
    // A roving-tabindex grid: its row button is focused directly, then driven by keyboard.
    const view = page
      .getByRole('row')
      .filter({ hasText: serial })
      .getByRole('button', { name: t('printHistory.actions.view') })
      .first();
    await expect(async () => {
      await view.focus();
      await expect(view).toBeFocused();
    }).toPass({ timeout: 5000 });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // The certificate preview inside is heavy to tear down, so retry Esc while the dialog stays.
    await expect(async () => {
      if (await dialog.isVisible()) await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
  });

  await test.step('arrow keys move from the register tab to the To print tab', async () => {
    const register = page.getByRole('tab', { name: t('printHistory.tabs.register') });
    await expect(register).toHaveAttribute('aria-selected', 'true');
    await register.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: t('printHistory.tabs.toPrint') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/tab=to-print/);
  });

  await test.step('Tab reaches a group print link; Enter opens the preview with the ids', async () => {
    // Plural names ("Print 6 admit cards") cannot go through the spec `t()`, so walk Tab to the
    // first link that points at the preview.
    // The tab strip re-renders on switch and drops focus: start again from the selected tab.
    await page.getByRole('tab', { name: t('printHistory.tabs.toPrint') }).focus();
    // The groups load after the tab opens: wait for a link to exist before walking Tab.
    await expect(page.locator('a[href*="/print/preview"]').first()).toBeVisible();
    let reached = false;
    for (let i = 0; i < 60 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        () =>
          (document.activeElement as HTMLAnchorElement | null)?.href?.includes('/print/preview') ??
          false,
      );
    }
    expect(reached, 'a print link on the To print tab is reachable by Tab').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/print\/preview\?.*ids=/);
  });
});
