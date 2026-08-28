import { shells } from '../config';
import { expect, guest, test } from '../fixtures/test';

import { waitForSwControl } from './helpers';

/**
 * [8.12.6] AC 1 — "install prompt appears and installation succeeds",
 * reinterpreted as far as a browser will honestly let a test go.
 *
 * ## Why this is not "click the install button"
 *
 * The install prompt is browser chrome. `beforeinstallprompt` only fires
 * against a user-gesture heuristic Chrome does not expose to automation,
 * the install dialog itself is native UI outside the page, and Lighthouse
 * 12 — what `@lhci/cli` 12 pins, see `lighthouserc.cjs` — deleted the PWA
 * category (`installable-manifest`, `service-worker`) entirely. There is
 * no supported way to assert "the OS installed the app".
 *
 * What *is* assertable is every condition Chrome checks before it offers
 * the prompt, which is what this spec pins:
 *
 * ```text
 *   manifest served + linked  ─┐
 *   name/short_name/display    ├─▶ Chrome offers install
 *   icons ≥192 and ≥512        │
 *   service worker controlling ┘
 *   start_url boots offline (the promise install makes to the user)
 * ```
 *
 * A regression in any one of them takes installability away, and each one
 * fails this spec by name. The manifest *object* is separately pinned by
 * `client-admin/src/pwa/manifest.test.ts`; this asserts the built,
 * served artefact matches it.
 */
test.describe('installability', () => {
  test.use(guest);

  test('manifest is served, linked, and describes an installable app', async ({ page }) => {
    await page.goto('/login');

    const href = await page.locator('link[rel="manifest"]').first().getAttribute('href');
    expect(href, 'index.html must link a manifest — vite-plugin-pwa injects this').toBeTruthy();

    const response = await page.request.get(new URL(href!, page.url()).toString());
    expect(response.status()).toBe(200);

    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      icons: { sizes: string; purpose?: string }[];
    };

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');

    // Chrome's minimum icon set: something ≥192 for the home screen and
    // something ≥512 for the splash. The maskable copy is a separate
    // entry on purpose (different artwork — see `pwa/manifest.ts`).
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  test('service worker registers, activates and controls the page', async ({ page }) => {
    await page.goto('/login');
    const scriptURL = await waitForSwControl(page);
    // The real built worker, not MSW's — `pwa/register.ts` skips
    // registration entirely under `VITE_USE_MOCKS`, so a mock-mode build
    // slipping into this suite would surface here rather than as a
    // mysteriously empty cache three specs later.
    expect(scriptURL).toContain('/sw.js');
  });

  test('start_url still boots with the network down', async ({ page, context }) => {
    await page.goto('/');
    await waitForSwControl(page);

    // A second *online* load of `start_url` first. The precache holds the
    // shell (`index.html`, `assets/app-*.js`, CSS, icons — `vite.config.ts`'s
    // `globPatterns`) but deliberately not the route chunks, which are
    // cached by `CacheFirst` as they are actually fetched. A cold visit to
    // `/` redirects out of the index route inside `__root.tsx`'s guard
    // before that route's own chunk is ever requested, so without this the
    // offline load below would be missing a chunk the first load never
    // fetched either — a test of chunk-splitting, not of offline boot.
    await page.reload();
    await expect(page.getByRole('heading', { name: shells.app.heading })).toBeVisible();

    await context.setOffline(true);
    // Pinned explicitly: the whole suite's offline lever is
    // `context.setOffline`, and it is only honest if the page (and, via
    // the same CDP emulation, the service worker) actually believes the
    // network is gone.
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await page.reload();

    // An offline cold boot cannot restore the session — `/auth/refresh`
    // needs the network, so `__root.tsx`'s guard sends an unauthenticated
    // visitor to `/login`. That is exactly what an installed app opening
    // on a dead connection shows, and the point of the assertion is that
    // it is *the app*, rendered from the precache, rather than the
    // browser's offline error page.
    await expect(page.getByRole('heading', { name: shells.app.heading })).toBeVisible();

    await context.setOffline(false);
  });
});
