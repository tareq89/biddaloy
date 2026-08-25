import type { Page } from '@playwright/test';

/** [8.5.6] Keyboard-only helpers — every interaction goes through
 * `page.keyboard`; nothing here (or in the specs using it) touches the
 * mouse. */

export async function focusedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    // <body> holds the whole document's text — matching against it would
    // make any label "reachable". Treat it as no focus.
    if (!el || el === document.body) return '';
    return (
      el.getAttribute('aria-label') ??
      (el as HTMLInputElement).labels?.[0]?.textContent ??
      el.textContent ??
      ''
    ).trim();
  });
}

/** Presses Tab until the focused element's accessible text contains
 * `text`. Throws after `max` presses — a spec that can't reach its
 * target by keyboard has found a real reachability bug. */
export async function tabUntilFocused(
  page: Page,
  text: string,
  max = 60,
  options: { tag?: string } = {},
): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    if (!(await focusedText(page)).includes(text)) continue;
    if (options.tag) {
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      // Same accessible text can exist as both a nav link and a button
      // (e.g. "Record payment" is the sidebar link, the wizard title AND
      // the submit button) — the caller can pin the element kind.
      if (tag !== options.tag.toUpperCase()) continue;
    }
    return;
  }
  throw new Error(`could not reach "${text}" within ${max} Tab presses`);
}
