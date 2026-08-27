import { resolve } from 'path';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { pwaManifest } from './src/pwa/manifest';

export default defineConfig({
  plugins: [
    // Must come before react() — the plugin transforms route files (and
    // generates routeTree.gen.ts) before the React plugin ever sees them.
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      // Colocated `*.test.tsx` files (this repo's convention — see
      // ui/CONTRIBUTING.md's three-file requirement) live right next to
      // their route file. Without this, the plugin treats each one as its
      // own route and fails the build.
      routeFileIgnorePattern: '\\.(test|spec)\\.[jt]sx?$',
    }),
    react(),
    tailwindcss(),
    // [8.12.1]: installability + offline app shell.
    //
    // `injectManifest`, not `generateSW` — the service worker is
    // hand-written (`src/sw.ts`) because tenant-safe API caching needs a
    // custom `cacheKeyWillBeUsed`, which `generateSW`'s declarative config
    // cannot express. See `src/pwa/cache-policy.ts` for why.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // `prompt`, not `autoUpdate`: an activated update must not reload
      // the page out from under someone mid-form. [8.12.2] owns the
      // prompt UI; `src/pwa/register.ts` holds the (currently no-op) hook.
      registerType: 'prompt',
      // The manifest object is imported rather than inlined so
      // `src/pwa/manifest.test.ts` asserts against exactly what ships.
      manifest: pwaManifest,
      // The registration call is ours (`src/main.tsx` -> `src/pwa/register.ts`),
      // so the plugin must not inject a second one. Note this flag governs
      // the *register script only*: the `<link rel="manifest">` is still
      // injected unconditionally, which is why `index.html` no longer
      // writes one by hand.
      injectRegister: null,
      includeAssets: [],
      injectManifest: {
        // The *shell* only — `index.html`, the entry JS/CSS, fonts and
        // icons. Deliberately not `**/*.js`: [8.9.1] split every route
        // into its own lazily-fetched chunk, and precaching all of them
        // would eagerly pull ~1.4 MB on first visit and re-pull it on
        // every deploy. That is the exact cost this epic exists to avoid
        // on a mid-range Android on 3G. Route chunks are instead cached
        // as they are actually visited, by the `CacheFirst` runtime route
        // in `src/sw.ts` — which is safe because their filenames are
        // content-hashed.
        globPatterns: [
          'index.html',
          'manifest.webmanifest',
          'favicon.svg',
          'icons/*.png',
          // The entry chunk only. `app-` is why `entryFileNames` is
          // overridden in `build.rollupOptions` below: Rollup's default
          // names the entry `index-<hash>.js`, and so are the dozen route
          // chunks that come from a route's `index.tsx`, which makes the
          // shell impossible to glob apart from the routes.
          'assets/app-*.js',
          'assets/*.css',
        ],
        // `mockServiceWorker.js` is MSW's worker script, only ever used
        // when `VITE_USE_MOCKS=true` (and `src/pwa/register.ts` skips PWA
        // registration entirely in that mode) — precaching it would ship
        // a mocking harness to production users. `stats.html` is the
        // `ANALYZE=true` bundle report above, not app output.
        globIgnores: ['**/mockServiceWorker.js', '**/stats.html'],
      },
      // No service worker in `vite dev`: it would cache the dev server's
      // unhashed module URLs and make every subsequent edit look like it
      // did not apply. The SW exists in `vite build`/`vite preview` only —
      // which is what CI's Lighthouse run and [8.12.5]'s Playwright suite
      // exercise.
      devOptions: { enabled: false },
    }),
    // `yarn build:analyze` (ANALYZE=true) opens a chunk-size treemap after
    // build — [8.9.1]'s "route-level code splitting verified in a bundle
    // report" AC. Off by default: it writes stats.html into dist/, which a
    // normal `yarn build:client-admin` shouldn't produce.
    ...(process.env.ANALYZE === 'true'
      ? [visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true, open: true })]
      : []),
  ],
  // No `base`: [8.9.10] serves this single SPA from `/`, so asset URLs are
  // root-relative. It used to be `/admin/`, back when a second package was
  // expected to own `/student/`.
  build: {
    rollupOptions: {
      output: {
        // [8.12.1]: distinguishes the entry from route chunks by name, so
        // the service worker can precache the shell without also
        // precaching every lazily-split route. See `globPatterns` above.
        entryFileNames: 'assets/app-[hash].js',
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@biddaloy/shared': resolve(__dirname, '../shared/src'),
      '@biddaloy/ui/components': resolve(__dirname, '../ui/src/components/index.ts'),
      '@biddaloy/ui/shells': resolve(__dirname, '../ui/src/shells/index.ts'),
      '@biddaloy/ui/hooks': resolve(__dirname, '../ui/src/hooks/index.ts'),
      '@biddaloy/ui/routes': resolve(__dirname, '../ui/src/routes/index.ts'),
      '@biddaloy/ui/utils': resolve(__dirname, '../ui/src/utils/index.ts'),
      '@biddaloy/ui/i18n': resolve(__dirname, '../ui/src/i18n/index.ts'),
      '@biddaloy/ui/api': resolve(__dirname, '../ui/src/api/index.ts'),
      '@biddaloy/ui/test': resolve(__dirname, '../ui/src/test/index.ts'),
      '@biddaloy/ui/mocks': resolve(__dirname, '../ui/src/test/msw/enable-mocking.ts'),
      '@biddaloy/ui/styles': resolve(__dirname, '../ui/src/styles/globals.css'),
      '@biddaloy/ui/tailwind': resolve(__dirname, '../ui/tailwind.preset.ts'),
      '@biddaloy/ui': resolve(__dirname, '../ui/src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        // No changeOrigin: the API's SameOriginGuard compares the Origin
        // header (always :5174 from the browser) against the Host header —
        // rewriting Host to :3000 makes every /auth/refresh a 403 ([8.5.2]).
        // The target is a plain local port, not a vhost, so Host rewriting
        // buys nothing.
      },
    },
  },
});
