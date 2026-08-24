import { expect, loggedIn, test } from '../fixtures/test';
import { AppShellPage } from '../pages/app-shell';
import { SchoolPickerPage } from '../pages/school-picker';

/**
 * [8.5.7] Journey 2: tenant selection and switching. The seed admin is
 * multi-membership (Default School + Rose Valley School — see
 * `server/src/scripts/seed.ts`).
 */

test.describe('without a persisted tenant', () => {
  test.use(loggedIn('admin', { tenant: 'none' }));

  test('picker shows, choice lands in the school and persists across reload', async ({ page }) => {
    const picker = new SchoolPickerPage(page);
    await test.step('multi-membership admin gets /select-school', async () => {
      await page.goto('/');
      await picker.expectLoaded();
    });
    await test.step('picking a school lands in it', async () => {
      await picker.choose('Default School');
      await expect(page).toHaveURL(/\/dashboard/);
    });
    await test.step('choice persisted', async () => {
      const persisted = await page.evaluate(() =>
        window.localStorage.getItem('biddaloy:activeTenant'),
      );
      expect(persisted).toBeTruthy();
      await page.reload();
      await expect(page).toHaveURL(/\/dashboard/);
      const shell = new AppShellPage(page);
      await shell.expectCurrentSchool('Default School');
    });
  });
});

test.describe('with a persisted tenant', () => {
  test.use(loggedIn('admin'));

  test('tenant bar switches school and the choice survives reload', async ({ page }) => {
    const shell = new AppShellPage(page);
    await test.step('start in Default School', async () => {
      await page.goto('/dashboard');
      await shell.expectCurrentSchool('Default School');
    });
    await test.step('switch via tenant bar', async () => {
      await shell.switchSchool('Rose Valley School');
      await shell.expectCurrentSchool('Rose Valley School');
    });
    await test.step('reload stays in the chosen school', async () => {
      await page.reload();
      await shell.expectCurrentSchool('Rose Valley School');
    });
  });
});
