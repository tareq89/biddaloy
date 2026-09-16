import { expect, guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import { expectNoAxeViolations } from '../a11y/assert';
import { expectNoHorizontalScrollAtWidth, pageOrDialogHeading } from '../responsive/assert';
import { resolvePath, routes, type ManifestRoute } from '../responsive/routes';

/**
 * [18.1.2] PR-facing smoke check — the route-sweep specs (a11y, reflow,
 * target-size: ~79% of E2E runtime) are tagged `@sweep` and moved to
 * nightly-e2e.yml only. This spec is what stays on every PR: a fixed
 * three-route sample gets both an axe scan and a reflow check at the two
 * widths that matter most (320px mobile, 1280px desktop), so a11y/reflow
 * regressions are still caught before merge even though the full manifest
 * sweep is not.
 *
 * Routes chosen to cover the three access patterns the sweeps exercise:
 * `/login` (guest, bespoke), `/fees/dues` (accountant, list/table),
 * `/portal` (parent, bespoke guardian surface).
 */
const SMOKE_WIDTHS = [320, 1280] as const;

const SMOKE_PATHS = ['/login', '/fees/dues', '/portal'] as const;

const SMOKE_ROUTES: ManifestRoute[] = SMOKE_PATHS.map((path) => {
  const route = routes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`Missing required smoke route: ${path}`);
  return route;
});

for (const route of SMOKE_ROUTES) {
  test.describe(route.path, () => {
    if (route.role === 'guest') test.use(guest);
    else test.use(loggedIn(route.role as SeedRole));

    test('has zero axe violations', async ({ page, request }) => {
      const path = await resolvePath(request, route);
      await page.goto(path);
      await expect(pageOrDialogHeading(page, route)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    for (const width of SMOKE_WIDTHS) {
      test(`no horizontal scroll at ${width}px`, async ({ page, request }) => {
        await expectNoHorizontalScrollAtWidth(page, request, route, width);
      });
    }
  });
}
