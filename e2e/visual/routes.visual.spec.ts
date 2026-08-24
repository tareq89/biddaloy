import { expect, guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import { routes } from '../responsive/routes';
import { applyDeterminism, assertLinux, readyForCapture } from './determinism';

/**
 * [8.5.4] Full-page route screenshots at 1280×800, chromium baselines
 * only (see e2e/VISUAL.md for widening). Static routes only: a
 * `$param` route's content comes from records the harness seeds with
 * unique names, which can never produce a stable baseline — dynamic
 * screens are covered at the component level by the Storybook suite.
 * Masks come from the manifest's optional `visualMask` selector list.
 */

assertLinux();

const staticRoutes = routes.filter((route) => !route.path.includes('$'));

function slug(path: string): string {
  return path === '/' ? 'root' : path.replace(/^\//, '').replace(/\//g, '--');
}

for (const route of staticRoutes) {
  test.describe(route.path, () => {
    if (route.role === 'guest') test.use(guest);
    else if (route.path === '/select-school')
      test.use(loggedIn(route.role as SeedRole, { tenant: 'none' }));
    else test.use(loggedIn(route.role as SeedRole));

    test(`matches the ${slug(route.path)} baseline`, async ({ page }) => {
      await applyDeterminism(page);
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await readyForCapture(page);
      const masks = ((route as { visualMask?: string[] }).visualMask ?? []).map((selector) =>
        page.locator(selector),
      );
      await expect(page).toHaveScreenshot(`${slug(route.path)}.png`, {
        fullPage: true,
        mask: masks,
      });
    });
  });
}
