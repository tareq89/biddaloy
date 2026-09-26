import { expect, type Page } from '@playwright/test';

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
 * target by keyboard has found a real reachability bug.
 *
 * `shift: true` walks backwards (`Shift+Tab`) instead, for a target that
 * sits *before* the current focus in DOM order — going forwards from,
 * say, a page's main content to a header action wraps through the whole
 * sidebar nav first, which is both slow and prone to blowing `max`. */
export async function tabUntilFocused(
  page: Page,
  text: string,
  max = 60,
  options: { tag?: string; shift?: boolean } = {},
): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press(options.shift ? 'Shift+Tab' : 'Tab');
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
  throw new Error(
    `could not reach "${text}" within ${max} ${options.shift ? 'Shift+Tab' : 'Tab'} presses`,
  );
}

/** Opens a focused Radix `Select` trigger and picks `value` by typeahead.
 * Waits for the exact option to render before pressing Enter on it,
 * rather than typing straight into the not-yet-open listbox — typing
 * immediately after the `Enter` that opens it can lose keystrokes to the
 * listbox's own open animation/focus-trap setup, landing on whatever
 * option happened to be highlighted instead of the one this typed.
 * Picking by unique name rather than "ArrowDown, Enter" matters too: the
 * pickers this is used on list every row in the shared e2e database, so a
 * positional pick can land on a stale row from another run instead of the
 * data this test just created. */
export async function selectByTypeahead(page: Page, value: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.keyboard.type(value);
  const option = page.getByRole('option', { name: value, exact: true });
  await expect(option).toBeVisible();
  await option.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
}
