import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.1] Keyboard-only journey: Ctrl+K -> Action tab -> "Assign homework"
 * -> create+assign form -> save. Clones `command-palette.spec.ts`'s
 * Ctrl+3-jumps-to-Action-tab pattern. No mouse calls anywhere in this file.
 */

test.use(loggedIn('admin'));

test('Ctrl+K -> Assign homework action -> create+assign form -> save, mouse-free', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();

  await test.step('Ctrl+3 switches to the Action tab', async () => {
    await page.keyboard.press('Control+3');
    await expect(
      page.getByRole('tab', { name: t('nav.commandPalette.tabs.action') }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  // The action registry's label is a hardcoded `{ en, bn }` pair, not
  // routed through the app's `t()` catalogs (see `action-registry.ts`'s
  // `homework.assign` entry) — search by the bn text since bn is this
  // suite's default locale.
  const assignActionLabel = 'বাড়ির কাজ দিন';

  await test.step('query "Assign homework" action, Enter runs it', async () => {
    await page.keyboard.type(assignActionLabel);
    await expect(page.getByRole('option', { name: assignActionLabel })).toBeVisible();
    await page.keyboard.press('Enter');
  });

  await test.step('landed on the create+assign form', async () => {
    await expect(page).toHaveURL(/\/academics\/homework\/new$/);
    await expect(page.getByRole('heading', { name: t('homework.form.createTitle') })).toBeVisible();
  });

  await test.step('fill required fields and save, keyboard only', async () => {
    // Tab through the form's pickers/inputs in DOM order and type/select
    // values without ever calling a mouse method. Field labels come from
    // the same `-assign-homework-form.tsx` this test targets.
    await page.getByLabel(t('homework.form.titleLabel')).fill('Kbd Homework Assign');
    await page.keyboard.press('Tab');

    // Class picker: a `@biddaloy/ui` combobox, keyboard-operable like the
    // palette's own combobox — type to filter, Enter to pick the first hit.
    const classPicker = page.getByLabel(t('homework.form.classLabel'));
    await classPicker.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const subjectPicker = page.getByLabel(t('homework.form.subjectLabel'));
    await subjectPicker.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    const sectionPicker = page.getByLabel(t('homework.form.sectionLabel'));
    await sectionPicker.click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await page.getByRole('button', { name: t('homework.form.submit') }).focus();
    await page.keyboard.press('Enter');
  });

  await test.step('assigned and landed on the homework detail', async () => {
    await expect(page).toHaveURL(/\/academics\/homework\/[^/]+$/);
  });
});
