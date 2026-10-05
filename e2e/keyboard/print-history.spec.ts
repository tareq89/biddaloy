import { adminApiSession, createStudent, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [32.4.5] Print history ("Printables & documents"), KEYBOARD ONLY: reach it from the
 * palette, filter by name, open a row's details, close them with Esc. No `.click(` and
 * no `page.mouse` reaches the surfaces under test.
 *
 * The API sets the scene (one printed card for a uniquely named student), so the filter
 * has exactly one thing to find in the shared database.
 */

test.use(loggedIn('admin'));

test('keyboard-only: find a printed card by name and read its details', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const name = `Kb History ${Date.now()}`;
  const student = await createStudent(request, session, name);
  const templates = await get<Array<{ id: string; document_kind: string; is_default: boolean }>>(
    request,
    session,
    '/print-templates?document_kind=STUDENT_ID_CARD',
  );
  const template = templates.find((x) => x.is_default) ?? templates[0];
  if (!template) throw new Error('No student template — has `yarn seed` run?');
  await post(request, session, '/print-jobs', {
    template_id: template.id,
    subject_type: 'STUDENT',
    subject_ids: [student.id],
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('Ctrl+K, the Page tab, "Printables" -> the history', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+2');
    await page.keyboard.type(t('nav.items.printables'));
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('printHistory.title') })).toBeVisible();
  });

  await test.step("filter by the person's name", async () => {
    await tabUntilFocused(page, t('printHistory.filters.search'), 90, { tag: 'INPUT' });
    // Type once: the search box must keep every keystroke while its own URL commit round-trips.
    await page.keyboard.type(name);
    await expect(page.getByRole('textbox', { name: t('printHistory.filters.search') })).toHaveValue(
      name,
    );
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
  });

  await test.step('open the row with Enter, read the snapshot, close with Esc', async () => {
    // The table is a roving-tabindex grid, so a row's own button cannot be reached by plain
    // Tab; focus it directly, then drive by keyboard (same shape as teaching-assignments).
    const view = page
      .getByRole('row')
      .filter({ hasText: name })
      .getByRole('button', { name: t('printHistory.actions.view') });
    await expect(async () => {
      await view.first().focus();
      await expect(view.first()).toBeFocused();
    }).toPass({ timeout: 5000 });
    await view.first().press('Enter');

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(t('printHistory.item.title'))).toBeVisible();
    await expect(dialog.getByText(name)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
