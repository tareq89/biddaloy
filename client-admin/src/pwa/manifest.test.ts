/**
 * The executable stand-in for the Lighthouse PWA category.
 *
 * `@lhci/cli ^0.15.1` ships Lighthouse 12, which deleted the PWA category
 * outright — `installable-manifest` and `service-worker` no longer exist
 * as audits, so [8.12.1]'s "Lighthouse PWA checks pass" AC has nothing to
 * assert against in CI. These are the fields Chrome actually requires
 * before it will fire `beforeinstallprompt`; asserting them here keeps the
 * regression caught at test time. The "the install prompt really appeared
 * in a real browser" half is [8.12.5]'s Playwright job.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pwaManifest, THEME_COLOR } from './manifest';

describe('pwaManifest', () => {
  it('names the app for both the install dialog and the home screen', () => {
    expect(pwaManifest.name).toBe('Biddaloy — School Management');
    expect(pwaManifest.short_name).toBe('Biddaloy');
    // Android truncates a longer home-screen label.
    expect(pwaManifest.short_name.length).toBeLessThanOrEqual(12);
  });

  it('scopes the app to the site root, matching a SPA served from `/`', () => {
    // `vite.config.ts` sets no `base` ([8.9.10]). A `start_url` outside
    // `scope` makes the app non-installable; both being `/` is what lets a
    // deep-linked install still open the whole SPA.
    expect(pwaManifest.start_url).toBe('/');
    expect(pwaManifest.scope).toBe('/');
  });

  it('requests a standalone window with brand-600 chrome', () => {
    expect(pwaManifest.display).toBe('standalone');
    expect(pwaManifest.theme_color).toBe('#4a3fd4');
    expect(THEME_COLOR).toBe(pwaManifest.theme_color);
    // The token ground (`--color-bg` = neutral-50), matching what
    // `index.html`'s `bg-background` paints, so the splash does not flash a
    // different colour than the first frame of the app.
    //
    // This literal and the one in `manifest.ts` are two hand-written copies,
    // so this assertion alone only proves they agree with each other.
    // `ui/scripts/check-contrast.mjs` is what ties them back to
    // `tailwind.preset.ts`; if the ground token moves, that gate fails here.
    expect(pwaManifest.background_color).toBe('#f8fafc');
  });

  it('describes the app, so the install dialog is not just a bare name', () => {
    expect(pwaManifest.description.length).toBeGreaterThan(0);
  });

  it('ships the 192px and 512px PNG icons Chrome requires to install', () => {
    const any = pwaManifest.icons.filter((icon) => icon.purpose === 'any');
    expect(any.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512']);
    expect(any.every((icon) => icon.type === 'image/png')).toBe(true);
  });

  it('ships a separate maskable icon so Android does not crop the lettermark', () => {
    const maskable = pwaManifest.icons.filter((icon) => icon.purpose === 'maskable');
    expect(maskable).toHaveLength(1);
    expect(maskable[0]?.sizes).toBe('512x512');
    // A distinct file, not the `any` art relabelled — the safe-zone
    // artwork differs. See `manifest.ts`.
    expect(maskable[0]?.src).not.toBe(
      pwaManifest.icons.find((icon) => icon.purpose === 'any' && icon.sizes === '512x512')?.src,
    );
  });

  it('uses root-relative icon paths, since there is no `base`', () => {
    for (const icon of pwaManifest.icons) {
      expect(icon.src.startsWith('/')).toBe(true);
    }
  });

  it('points every icon at a file that actually exists in `public/`', () => {
    // A manifest referencing a missing icon is silently non-installable —
    // Chrome rejects it, and nothing in the build fails. Vite copies
    // `public/` to the dist root verbatim, so `public/<src>` is exactly
    // where each declared path resolves from.
    for (const icon of pwaManifest.icons) {
      const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../public', `.${icon.src}`);
      expect(existsSync(file), `missing icon: ${icon.src}`).toBe(true);
    }
  });
});
