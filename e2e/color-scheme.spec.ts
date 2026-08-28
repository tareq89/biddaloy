import { expect, guest, test } from './fixtures/test';

/**
 * [8.13.7] The `<body>` is token-driven, and the OS colour-scheme
 * preference alone must not change a single pixel of it.
 *
 * Before this ticket `client-admin/index.html` carried a hard-coded white
 * ground, a zinc-900 text colour and OS-keyed dark variants of both (the
 * classes are not spelled out here: Tailwind scans comment text, so writing
 * them inline risks compiling junk rules — see reduced-motion.spec.ts).
 * Those dark variants compiled to `@media (prefers-color-scheme: dark)`,
 * while the design tokens key off `:root[data-theme="dark"]` — so a user
 * with a dark OS gave themselves a dark page ground under light token
 * colours everywhere else. Dark mode is not shipped yet ([8.13.12] adds the
 * toggle); until it is, the app renders light for everyone.
 *
 * Only a real browser can prove this: jsdom does not evaluate
 * `prefers-color-scheme` against a real stylesheet, and `check-contrast`'s
 * compiled-CSS gate can prove the variant is attribute-scoped but not that
 * the rendered page is unaffected.
 *
 * Deliberately hex-independent. The assertion is "light and dark OS render
 * the *same* colours", not "the ground is #f8fafc" — so [8.13.x] palette
 * changes cannot make this spec fail for the wrong reason. The one absolute
 * assertion is that the ground is not near-black, which is what the removed
 * dark variant produced and the only way to catch "both schemes are
 * equally broken".
 *
 * `/login` is used because it is reachable signed-out.
 */

async function bodyColours(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const computed = getComputedStyle(document.body);
    return {
      background: computed.backgroundColor,
      text: computed.color,
      // The switch dark mode WILL key off once [8.13.12] lands. Nothing sets
      // it today, and this spec records that.
      dataTheme: document.documentElement.getAttribute('data-theme'),
    };
  });
}

/** `rgb(15, 23, 42)` → 15. Used only for the "not near-black" sanity bound. */
function channels(colour: string): number[] {
  const parsed = colour.match(/\d+(?:\.\d+)?/g);
  expect(parsed, `could not parse computed colour ${colour}`).not.toBeNull();
  return parsed!.slice(0, 3).map(Number);
}

test.describe('OS colour scheme does not theme the page', () => {
  test.use(guest);

  test('renders the body identically under a light and a dark OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    const light = await bodyColours(page);

    // Same page, same elements, OS preference flipped. Without this half the
    // spec would pass on a page that never responded to anything.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/login');
    const dark = await bodyColours(page);

    expect(dark.background).toBe(light.background);
    expect(dark.text).toBe(light.text);

    // No SPA sets `data-theme` yet; dark mode is prepared, not shipped.
    expect(light.dataTheme).toBeNull();
    expect(dark.dataTheme).toBeNull();

    // The ground is a light surface in both, not the near-black the old
    // OS-keyed dark ground (#18181b) painted. Generous bound so a palette
    // re-grade does not trip it.
    for (const channel of channels(light.background)) {
      expect(channel).toBeGreaterThan(200);
    }
    // ...and the text is dark enough to be text on it.
    for (const channel of channels(light.text)) {
      expect(channel).toBeLessThan(120);
    }
  });

  test('applies the token overrides when data-theme is set, whatever the OS says', async ({
    page,
  }) => {
    // The other half of the contract: the attribute — not the OS — is the
    // switch. Set it by hand (nothing in the product does yet) under a LIGHT
    // OS preference, which is exactly the case the old OS-keyed variants
    // could not serve.
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    const before = await bodyColours(page);

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const after = await bodyColours(page);

    expect(after.background).not.toBe(before.background);
    for (const channel of channels(after.background)) {
      expect(channel).toBeLessThan(100);
    }
  });
});
