import { expect, guest, loggedIn, test } from '../fixtures/test';
import { expectNoHorizontalScroll, expectNoInnerHorizontalScroll } from '../pages/assertions';
import type { SeedRole } from '../seed-contract';
import { resolvePath, routes } from './routes';

/**
 * [8.5.6] WCAG 1.4.10 reflow, operationalized as viewport width
 * (Playwright has no browser-zoom API): 320 px is the 400% check,
 * 640 px stands in for 200% on a 1280 design. Those two assert no
 * horizontal page scroll on every manifest route; 768/1280/1920 are a
 * render smoke against layout regressions where the scroll assertion
 * never fails.
 */

const SCROLL_WIDTHS = [320, 640] as const;
const SMOKE_WIDTHS = [768, 1280, 1920] as const;

for (const route of routes) {
  test.describe(route.path, () => {
    if (route.role === 'guest') test.use(guest);
    else if (route.path === '/select-school')
      test.use(loggedIn(route.role as SeedRole, { tenant: 'none' }));
    else test.use(loggedIn(route.role as SeedRole));

    for (const width of SCROLL_WIDTHS) {
      test(`no horizontal scroll at ${width}px`, async ({ page, request }) => {
        await page.setViewportSize({ width, height: 900 });
        const path = await resolvePath(request, route);
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await expectNoHorizontalScroll(page);
        // [8.14.7] `DataTable`'s card mode ([8.14.7]) exists precisely so a
        // 320/640px page no longer needs its own inner scroll region —
        // this is the acceptance proof for that.
        await expectNoInnerHorizontalScroll(page);
      });
    }

    for (const width of SMOKE_WIDTHS) {
      test(`renders at ${width}px`, async ({ page, request }) => {
        await page.setViewportSize({ width, height: 900 });
        const path = await resolvePath(request, route);
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      });
    }
  });
}
