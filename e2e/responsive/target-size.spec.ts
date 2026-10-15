import type { Page } from '@playwright/test';

import { expect, guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import { skipIfKnown } from './known-failures';
import { undersizedTargets } from './assert';
import { resolvePath, routes, type ManifestRoute } from './routes';

/**
 * Same reasoning as `reflow.spec.ts`'s identical helper: a `redirect`
 * archetype route may land somewhere that opens a modal by default
 * (e.g. a legacy URL that lands on a page with a modal open), which
 * correctly `aria-hide`s the underlying `<h1>` while open — the dialog's own
 * required title is the equivalent "rendered something meaningful" signal.
 * (`/payments/record` used to be that case; it is now a full-page form.)
 */
function pageOrDialogHeading(page: Page, route: ManifestRoute) {
  const heading = page.getByRole('heading', { level: 1 }).first();
  if (route.archetype !== 'redirect') return heading;
  return heading.or(page.getByRole('dialog').first());
}

/**
 * [8.5.6] WCAG 2.2 SC 2.5.8 target size (minimum): every visible
 * interactive target ≥ 24×24 CSS px, exempting inline links inside text
 * blocks — the SC's own exception ("the target is in a sentence, or its
 * size is otherwise constrained by the line-height of non-target text").
 *
 * [8.13.8] adds a second, stricter pass at phone width (extended to every
 * shell by [31.5.5], see the bottom of this file). SC 2.5.8's 24px is the
 * floor for the whole app; SC 2.5.5 (target size, ENHANCED) asks for 44px.
 * The two assertions are deliberately separate rather than one parameterised
 * threshold: the 24px gate must keep covering every route in the manifest
 * even if the phone pass is ever quarantined.
 */

for (const route of routes) {
  test.describe(`${route.path} @sweep`, () => {
    if (route.role === 'guest') test.use(guest);
    else if (route.path === '/select-school')
      test.use(loggedIn(route.role as SeedRole, { tenant: 'none' }));
    else test.use(loggedIn(route.role as SeedRole));

    test('all interactive targets are at least 24x24 CSS px', async ({ page, request }) => {
      skipIfKnown('target24', route.path);
      const path = await resolvePath(request, route);
      await page.goto(path);
      await expect(pageOrDialogHeading(page, route)).toBeVisible();

      const undersized = await undersizedTargets(page, 24);

      expect(undersized, `targets under 24x24:\n${undersized.join('\n')}`).toEqual([]);
    });
  });
}

/**
 * [31.5.5] Phone gate (C2): below `md` every shell is comfortable —
 * `globals.css`'s media rule sets `--control-h: 2.75rem` — so EVERY
 * non-redirect manifest route must clear SC 2.5.5's 44px at 360x640, the
 * mid-range Android profile `lighthouserc.cjs` budgets against. Staff pages
 * stay dense only at `md` and up, which the 24px loop above covers.
 * Asserting at the widest breakpoint would let a control that reflows to
 * something smaller on a phone pass.
 */
for (const route of routes.filter((r) => r.archetype !== 'redirect')) {
  test.describe(`${route.path} (phone 44px) @sweep`, () => {
    if (route.role === 'guest') test.use({ ...guest, viewport: { width: 360, height: 640 } });
    else if (route.path === '/select-school')
      test.use({
        ...loggedIn(route.role as SeedRole, { tenant: 'none' }),
        viewport: { width: 360, height: 640 },
      });
    else test.use({ ...loggedIn(route.role as SeedRole), viewport: { width: 360, height: 640 } });

    test('all interactive targets are at least 44x44 CSS px', async ({ page, request }) => {
      skipIfKnown('target44', route.path);
      const path = await resolvePath(request, route);
      await page.goto(path);
      await expect(pageOrDialogHeading(page, route)).toBeVisible();

      // Proves the mechanism, not just the outcome: if the phone media rule
      // were dropped, every control would fall back to its compact height and
      // the assertion below would report a wall of 32px buttons without
      // ever saying why.
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim(),
        ),
      ).toBe('2.75rem');

      const undersized = await undersizedTargets(page, 44);

      expect(undersized, `targets under 44x44 on ${route.path}:\n${undersized.join('\n')}`).toEqual(
        [],
      );
    });
  });
}
