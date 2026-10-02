import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [32.4.5] Print templates, KEYBOARD ONLY: reach the library from the palette, open
 * "New template" with `n`, pick a design and a name, land in the full-screen editor, select
 * a layer, nudge it with the arrow keys, publish, and go back to the library. No `.click(`
 * and no `page.mouse`.
 *
 * Canvas drag / resize is pointer-only by nature (jsdom cannot cover it either); the
 * keyboard equivalents are what this spec proves.
 */

test.use(loggedIn('admin'));

test('keyboard-only: new template -> editor -> nudge a layer -> publish -> library', async ({
  page,
}) => {
  const name = `Kb Template ${Date.now()}`;

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('Ctrl+K, the Page tab, "Print templates" -> the library', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+2');
    await page.keyboard.type(t('nav.items.printTemplates'));
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('printTemplates.title') })).toBeVisible();
  });

  await test.step('`n` opens the New template dialog', async () => {
    // `n` is heard while focus is inside the list, so put focus on the list's own controls.
    await tabUntilFocused(page, t('printTemplates.new'), 90, { tag: 'BUTTON' });
    await page.keyboard.press('n');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(t('printTemplates.new_dialog.title')).first()).toBeVisible();
  });

  await test.step('pick a design, name it, create', async () => {
    const dialog = page.getByRole('dialog');
    // The first design card is the next tab stop after the kind buttons.
    const cards = dialog.locator('fieldset button[aria-pressed]');
    await expect(cards.first()).toBeVisible();
    await cards.first().focus();
    await page.keyboard.press('Space');
    await expect(cards.first()).toHaveAttribute('aria-pressed', 'true');

    const nameField = dialog.getByLabel(t('printTemplates.new_dialog.name'));
    await nameField.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(name);

    const create = dialog.getByRole('button', { name: t('printTemplates.new_dialog.create') });
    await create.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/print-templates\/[^/]+\/edit/);
  });

  await test.step('select a layer and nudge it 1 mm with ArrowRight x2', async () => {
    const layer = page.locator('[data-layer]').first();
    await expect(layer).toBeVisible();
    await layer.focus();
    await page.keyboard.press('Enter');
    await expect(layer).toHaveAttribute('aria-pressed', 'true');

    const x = page.getByRole('spinbutton', { name: t('printEditor.properties.x'), exact: true });
    const before = Number(await x.inputValue());
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(x).toHaveValue(String(Math.round((before + 1) * 10) / 10));
  });

  await test.step('publish by keyboard', async () => {
    const publish = page.getByRole('button', { name: t('printEditor.publish.button', { n: 1 }) });
    // Autosave has to finish first; the button enables when the draft is saved.
    await expect(publish).toBeEnabled();
    await publish.focus();
    await page.keyboard.press('Enter');

    const confirm = page.getByRole('dialog').getByRole('button', {
      name: t('printEditor.publish.confirm'),
      exact: true,
    });
    await expect(confirm).toBeVisible();
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText(t('printEditor.publish.done', { n: 1 }))).toBeVisible();
  });

  await test.step('go back to the library; the new template is listed', async () => {
    const back = page.getByRole('button', { name: t('printEditor.topbar.exit') });
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('printTemplates.title') })).toBeVisible();
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
  });
});
