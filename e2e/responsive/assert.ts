import type { APIRequestContext, Page } from '@playwright/test';

import { expect } from '../fixtures/test';
import { expectNoHorizontalScroll, expectNoInnerHorizontalScroll } from '../pages/assertions';
import { resolvePath, type ManifestRoute } from './routes';

/**
 * Most routes render their own `<h1>`. A `redirect` archetype route may
 * land somewhere that opens a modal by default instead (e.g.
 * `/payments/record` → `/payments?record=1`, auto-opening the Record
 * Payment modal to preserve the deep link) — Radix's `Dialog` correctly
 * `aria-hide`s the rest of the page while open, so the underlying page's
 * `<h1>` is legitimately absent from the accessibility tree in that case.
 * The dialog's own title (required by Radix's a11y contract on every
 * `DialogContent`) is the equivalent "the page rendered something
 * meaningful" signal for that case.
 */
export function pageOrDialogHeading(page: Page, route: ManifestRoute) {
  const heading = page.getByRole('heading', { level: 1 }).first();
  if (route.archetype !== 'redirect') return heading;
  return heading.or(page.getByRole('dialog').first());
}

/**
 * [8.5.6] WCAG 1.4.10 reflow at a given viewport width: no page-level or
 * `DataTable` inner horizontal scroll. Extracted out of
 * `reflow.spec.ts` in [18.1.2] so `e2e/smoke/routes.smoke.spec.ts` can run
 * the same check on every PR without depending on the sweep-only spec.
 */
export async function expectNoHorizontalScrollAtWidth(
  page: Page,
  request: APIRequestContext,
  route: ManifestRoute,
  width: number,
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const path = await resolvePath(request, route);
  await page.goto(path);
  await expect(pageOrDialogHeading(page, route)).toBeVisible();
  await expectNoHorizontalScroll(page);
  // [8.14.7] `DataTable`'s card mode exists precisely so a 320/640px page
  // no longer needs its own inner scroll region.
  await expectNoInnerHorizontalScroll(page);
}

/** Render smoke at a given viewport width — proves the route renders at
 * that width without asserting anything about scroll behavior. */
export async function expectRendersAtWidth(
  page: Page,
  request: APIRequestContext,
  route: ManifestRoute,
  width: number,
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const path = await resolvePath(request, route);
  await page.goto(path);
  await expect(pageOrDialogHeading(page, route)).toBeVisible();
}
