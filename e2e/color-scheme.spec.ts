import { expect, guest, test } from './fixtures/test';

/**
 * [8.13.7] shipped a `<body>` that was token-driven but deliberately
 * inert to `prefers-color-scheme`: dark mode existed in `globals.css` but
 * had no toggle, so an OS-dark visitor had to keep seeing the light page
 * everyone else saw, or the app would have been exposing dark mode by
 * accident rather than on purpose. [8.13.12] (#353) ships that toggle, so
 * this file's contract flips: an OS-dark visitor who has never made an
 * explicit choice now *should* get the dark page, not the light one.
 *
 * The rewrite keeps the two things [8.13.7]'s version got right and adds a
 * third:
 *
 *  1. Hex-independence — assertions are "is the ground light/dark", never
 *     "is the ground `#f8fafc`", so a future [8.13.x] palette re-grade
 *     cannot fail this spec for the wrong reason. Same `channels()`/
 *     `bodyColours()` helpers as before.
 *  2. Only a real browser can prove any of this: jsdom does not evaluate
 *     `prefers-color-scheme` against a real stylesheet, and
 *     `check-contrast.mjs`'s compiled-CSS gate can prove the `dark:`
 *     variant is attribute-scoped but not that a real page actually
 *     resolves it.
 *  3. New: no flash of the wrong theme. `client-admin/index.html`'s inline
 *     boot script has to apply `data-theme` before the app's JS bundle gets
 *     a chance to run at all, not merely before the first frame is
 *     *visible* — see the third `describe` block below for how that is
 *     actually observed.
 *
 * `theme-toggle.spec.ts` covers the toggle UI itself (click, persist,
 * reload); this file is only about the two inputs a visitor never
 * interacts with directly — the OS preference and whatever was already in
 * `localStorage` — and the moment before either has painted anything.
 *
 * `/login` is used because it is reachable signed-out.
 */

async function bodyColours(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const computed = getComputedStyle(document.body);
    return {
      background: computed.backgroundColor,
      text: computed.color,
      dataTheme: document.documentElement.getAttribute('data-theme'),
    };
  });
}

/** `rgb(15, 23, 42)` → 15. Used only for the "light ground"/"dark ground"
 * sanity bounds. */
function channels(colour: string): number[] {
  const parsed = colour.match(/\d+(?:\.\d+)?/g);
  expect(parsed, `could not parse computed colour ${colour}`).not.toBeNull();
  return parsed!.slice(0, 3).map(Number);
}

function expectLightGround(background: string): void {
  for (const channel of channels(background)) {
    expect(channel).toBeGreaterThan(200);
  }
}

function expectDarkGround(background: string): void {
  for (const channel of channels(background)) {
    expect(channel).toBeLessThan(100);
  }
}

test.describe('no stored choice: the OS preference decides', () => {
  test.use(guest);

  test('a dark OS preference renders data-theme="dark" and a dark ground', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    const dark = await bodyColours(page);

    expect(dark.dataTheme).toBe('dark');
    expectDarkGround(dark.background);
  });

  test('a light OS preference renders no data-theme and a light ground', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    const light = await bodyColours(page);

    expect(light.dataTheme).toBeNull();
    expectLightGround(light.background);
  });
});

test.describe('an explicit stored choice always wins over the OS preference', () => {
  test.use(guest);

  test('an explicit light choice stays light under a dark OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    // `localStorage` needs an existing document/origin before it can be
    // written, so this sets it after the first load and reloads — the
    // reload is what the boot script actually has to get right.
    await page.evaluate(() => localStorage.setItem('biddaloy:theme', 'light'));
    await page.reload();

    const after = await bodyColours(page);
    expect(after.dataTheme).toBeNull();
    expectLightGround(after.background);
  });

  test('an explicit dark choice stays dark under a light OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('biddaloy:theme', 'dark'));
    await page.reload();

    const after = await bodyColours(page);
    expect(after.dataTheme).toBe('dark');
    expectDarkGround(after.background);
  });
});

test.describe('no flash of the wrong theme', () => {
  test.use(guest);

  /**
   * `document.readyState` flips to `'interactive'` the instant the HTML
   * parser finishes — which happens BEFORE any deferred script runs.
   * `type="module"` scripts (the app's own `/src/main.tsx`) are deferred
   * by spec, exactly like a plain `defer` attribute, so this moment is
   * before the app bundle has executed a single line, let alone painted
   * anything. The inline boot script itself is a plain, non-deferred
   * `<script>` placed earlier in `<head>` — the parser runs it immediately,
   * synchronously, while still parsing `<head>` — so if it did its job,
   * `data-theme` is already correct well before `'interactive'`.
   *
   * `page.addInitScript` is required, not a plain `page.evaluate` after
   * `goto()`: it registers before any of the page's own scripts run (on
   * every navigation in this browser context), which is the only way to
   * observe a readyState transition that happens this early — a listener
   * attached after `goto()` resolves would already be too late.
   */
  async function themeAtInteractive(page: import('@playwright/test').Page): Promise<string | null> {
    await page.addInitScript(() => {
      document.addEventListener('readystatechange', () => {
        if (document.readyState === 'interactive') {
          (window as { __themeAtInteractive?: string | null }).__themeAtInteractive =
            document.documentElement.getAttribute('data-theme');
        }
      });
    });
    await page.goto('/login');
    return page.evaluate(
      () => (window as { __themeAtInteractive?: string | null }).__themeAtInteractive ?? null,
    );
  }

  test('a dark-OS, no-stored-choice visitor already has data-theme="dark" before the app bundle runs', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await themeAtInteractive(page)).toBe('dark');
  });

  test('an explicit dark choice under a light OS is already applied before the app bundle runs', async ({
    page,
  }) => {
    // Same reasoning as the "wins over the OS" block above: the choice has
    // to exist in `localStorage` before the boot script can read it, so
    // this seeds it via one throwaway visit, then measures the next one.
    await page.goto('/login');
    await page.evaluate(() => localStorage.setItem('biddaloy:theme', 'dark'));

    await page.emulateMedia({ colorScheme: 'light' });
    expect(await themeAtInteractive(page)).toBe('dark');
  });
});
