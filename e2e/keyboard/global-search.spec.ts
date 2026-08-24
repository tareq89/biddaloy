import { adminApiSession, createStudent } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/** [8.5.6] Global search, keyboard only: Ctrl/Cmd+K opens, typing
 * queries, arrows + Enter pick. No mouse calls in this file. */

test.use(loggedIn('admin'));

test('global search is fully keyboard-drivable', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const name = `Kbd Search ${Date.now()}`;
  await createStudent(request, session, name);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('open with the shortcut', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.globalSearch.ariaLabel') }),
    ).toBeFocused();
  });

  await test.step('query, arrow down, Enter', async () => {
    await page.keyboard.type(name);
    await expect(page.getByRole('option', { name: name }).first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  });

  await test.step('landed on the student detail', async () => {
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  });
});
