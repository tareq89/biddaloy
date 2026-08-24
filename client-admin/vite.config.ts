import { resolve } from 'path';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

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
