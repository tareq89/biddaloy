import { expect, loggedIn, test } from './fixtures/test';
import { t } from './i18n';

/**
 * #1322: the Analysis / Attendance print sheets stay loaded after you leave those screens (SPA
 * navigation keeps the CSS). Their rules must be scoped to their own print area, or the next
 * page prints blank. Navigate client-side (a reload would drop the stylesheet and hide the bug).
 */
test.use(loggedIn('admin'));

for (const [name, path] of [
  ['Analysis', '/analysis'],
  ['Attendance register', '/attendance/register'],
] as const) {
  test(`${name}: another page still shows its content in print media afterwards`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    await page
      .getByRole('navigation', { name: t('nav.navLabel') })
      .getByRole('link', { name: t('nav.items.dashboard'), exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(/\/dashboard/);
    const heading = page.getByRole('heading', { level: 1 }).first();
    await expect(heading).toBeVisible();

    await page.emulateMedia({ media: 'print' });
    await expect(heading).toBeVisible();
  });
}
