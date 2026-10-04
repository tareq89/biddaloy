import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';

const t = makeT('en');

/**
 * [47.4.4] "My class", KEYBOARD ONLY (no `page.mouse`, no `.click(`): the
 * command palette reaches the class teacher's screen, and the route puts
 * focus on the one thing a class teacher does each morning, the attendance
 * button.
 *
 * Palette action labels are plain `{ en, bn }` strings in
 * `client-admin/src/action-registry.ts` (not i18n keys), and `/my-class` is
 * matched on its English label/synonyms, so this spec pins the English locale.
 */

test.use({ ...loggedIn('teacher'), e2eLocale: 'en' });

const TAKE_ATTENDANCE = "Take my class's attendance";

test('Ctrl+K, "my class", Enter lands on the section with focus on the attendance button', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();
  // The palette opens on the People tab; "my class" is a page, so switch to Page.
  await page.keyboard.press('Control+2');
  await page.keyboard.type('my class');
  await expect(page.getByRole('option', { name: /my class/i }).first()).toBeVisible();
  await page.keyboard.press('Enter');

  // Single seeded section: the picker redirects to the section page.
  await expect(page).toHaveURL(/\/my-class\/[0-9a-f-]+$/);
  const attendance = page.getByRole('link', { name: t('myClass.takeAttendance') });
  await expect(attendance).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/attendance\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});

test('the palette action "Take my class\'s attendance" opens the register directly', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();
  // Actions live on the third tab (same as `command-palette.spec.ts`).
  await page.keyboard.press('Control+3');
  await page.keyboard.type(TAKE_ATTENDANCE);
  await expect(page.getByRole('option', { name: TAKE_ATTENDANCE })).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/attendance\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
});
