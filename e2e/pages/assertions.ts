import { expect, type Page } from '@playwright/test';

/** URL search-param assertion — the shells persist list/tab/wizard state
 * in the URL (`useListShellState`, `useDetailShellTab`,
 * `useWizardShellStep`), so specs assert state through the URL, not
 * internals. */
export async function expectUrlParam(page: Page, key: string, value: string): Promise<void> {
  await expect(page).toHaveURL((url) => url.searchParams.get(key) === value);
}

/** No horizontal page scroll — the 320/640 px reflow criterion (used by
 * the [8.5.6] responsive suite; lives here because it is a generic
 * page-level assertion, not a suite-specific one). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  // +1 absorbs subpixel rounding (WCAG 1.4.10 reflow check, [8.5.6]).
  expect(overflow, 'document should not scroll horizontally').toBeLessThanOrEqual(1);
}

/** [8.14.7] `expectNoHorizontalScroll` only measures `document.
 * documentElement` — before `DataTable`'s card mode existed, that was the
 * whole story, since the table's own `overflow-x-auto` region (`data-
 * table.tsx`) was the *intended* place for a 320px phone to scroll. That
 * inner scroll is exactly the defect [8.14.7] fixes: on a phone the
 * table's own scroll region should never need to scroll once card mode
 * has replaced it. This walks every element in the page (not just
 * `DataTable`'s known region) so a failure names the actual offending
 * selector rather than asserting a single hardcoded one — any *other*
 * `overflow-x: auto/scroll` element wider than its box is just as much a
 * phone-usability defect as the table was. */
export async function expectNoInnerHorizontalScroll(page: Page): Promise<void> {
  const offenders = await page.evaluate(() => {
    function cssSelector(element: Element): string {
      if (element.id) return `#${element.id}`;
      const classes = Array.from(element.classList).slice(0, 2).join('.');
      const tag = element.tagName.toLowerCase();
      return classes ? `${tag}.${classes}` : tag;
    }

    const found: string[] = [];
    for (const element of document.querySelectorAll('*')) {
      const overflowX = window.getComputedStyle(element).overflowX;
      if (overflowX !== 'auto' && overflowX !== 'scroll') continue;
      // +1 absorbs subpixel rounding, same tolerance as the document-level check.
      if (element.scrollWidth - element.clientWidth > 1) {
        found.push(cssSelector(element));
      }
    }
    return found;
  });
  expect(offenders, `elements with inner horizontal scroll: ${offenders.join(', ')}`).toEqual([]);
}
