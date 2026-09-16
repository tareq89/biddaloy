import { guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import { routes } from './routes';
import { expectNoHorizontalScrollAtWidth, expectRendersAtWidth } from './assert';

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
  test.describe(`${route.path} @sweep`, () => {
    if (route.role === 'guest') test.use(guest);
    else if (route.path === '/select-school')
      test.use(loggedIn(route.role as SeedRole, { tenant: 'none' }));
    else test.use(loggedIn(route.role as SeedRole));

    for (const width of SCROLL_WIDTHS) {
      test(`no horizontal scroll at ${width}px`, async ({ page, request }) => {
        await expectNoHorizontalScrollAtWidth(page, request, route, width);
      });
    }

    for (const width of SMOKE_WIDTHS) {
      test(`renders at ${width}px`, async ({ page, request }) => {
        await expectRendersAtWidth(page, request, route, width);
      });
    }
  });
}
