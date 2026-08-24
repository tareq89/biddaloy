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
  expect(overflow, 'document should not scroll horizontally').toBeLessThanOrEqual(0);
}
