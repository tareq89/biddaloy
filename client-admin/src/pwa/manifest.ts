/**
 * [8.12.1]'s web app manifest, as a plain module rather than a literal
 * buried in `vite.config.ts`.
 *
 * Two reasons it lives here:
 *
 *   1. `vite.config.ts` imports this object into `VitePWA({ manifest })`,
 *      so `manifest.test.ts` asserts against the *same* object that ships
 *      in `dist/manifest.webmanifest` — the tested shape and the shipped
 *      shape cannot drift.
 *   2. Lighthouse 12 (what `@lhci/cli ^0.15.1` pins) deleted the whole PWA
 *      category, `installable-manifest` and `service-worker` audits
 *      included — Chrome owns installability checking now. So the CI
 *      guard against "someone dropped the maskable icon and nobody
 *      noticed" has to be a unit test, and this is the module it points
 *      at. Browser-level "the install prompt actually fired" coverage is
 *      [8.12.5]'s Playwright job.
 *
 * All paths are root-relative because the SPA is served from `/`
 * (`vite.config.ts` sets no `base`; `server/src/main.ts` mounts the built
 * client at the root). Note the stale `base: '/admin/'` comment in
 * `main.tsx` — it describes a layout that no longer exists.
 */

/** Matches `--color-brand-600` in `ui/src/styles/globals.css`. Repeated as
 * a literal because a `.webmanifest` is consumed by the OS, not by
 * Tailwind — there is no CSS custom property to resolve at install time.
 *
 * `ui/scripts/check-contrast.mjs` owns the token itself, and since [8.13.3]
 * it also asserts that this file, `index.html`'s `theme-color` meta tag and
 * `public/favicon.svg` all still contain the brand-600 hex. Before that it
 * only ever read `globals.css` and `tailwind.preset.ts`, so this literal and
 * the favicon were free to drift — and did. */
export const THEME_COLOR = '#4a3fd4';

interface PwaManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: 'any' | 'maskable';
}

export interface PwaManifest {
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  theme_color: string;
  background_color: string;
  icons: PwaManifestIcon[];
}

export const pwaManifest: PwaManifest = {
  name: 'Biddaloy — School Management',
  // Android home screens truncate past ~12 characters, so `short_name` is
  // the bare brand, not a shortened sentence.
  short_name: 'Biddaloy',
  description: 'Manage students, fees, attendance and communications for your school.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: THEME_COLOR,
  // The token ground, not the brand colour: this paints the splash screen
  // behind the icon, and the app itself boots onto that same surface
  // (`index.html`'s `bg-background`, which resolves to `--color-bg` =
  // `neutral-50`, design contract §3.3). A brand-coloured splash would
  // flash indigo and then snap to the ground colour on first paint.
  //
  // Repeated as a literal for the same reason as `THEME_COLOR` above: a
  // `.webmanifest` is consumed by the OS, not by Tailwind, so there is no
  // custom property to resolve at install time.
  //
  // `manifest.test.ts` pins the value, but that test is a second hand-written
  // copy of the same literal, so on its own it only proves the two copies
  // agree with each other — not that either still matches the token. The
  // check that compares this file against tailwind.preset.ts is
  // `ui/scripts/check-contrast.mjs`, which reads the neutral-50 value from
  // the preset and asserts it appears here.
  background_color: '#f8fafc',
  icons: [
    { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // Separate entry rather than `purpose: 'any maskable'` on the 512:
    // a maskable icon is full-bleed with the glyph inside the central 40%
    // safe zone, which is a *different artwork* from the rounded-square
    // `any` icon. Declaring one file as both makes Android crop the
    // rounded corners off the `any` art.
    { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
