import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [28.4.8] Keyboard-only: Ctrl+K "Publish teacher survey" opens the survey
 * dialog on the Surveys tab (the palette navigates with `?publishSurvey=1`,
 * which TanStack parses as a number). Ctrl+Enter with an empty form must show
 * the validation alert, not submit.
 */
test.use(loggedIn('admin'));

test('keyboard-only: palette opens the survey form, Ctrl+Enter validates', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  await expect(
    page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
  ).toBeFocused();
  await page.keyboard.press('Control+3');
  await page.keyboard.type(t('evaluations.palette.publishSurvey'));
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: t('evaluations.surveys.form.title') });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/tab=surveys/);

  // Focus lands inside the dialog; Ctrl+Enter submits the (empty) form.
  await page.getByLabel(t('evaluations.surveys.form.titleLabel')).focus();
  await page.keyboard.press('Control+Enter');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
