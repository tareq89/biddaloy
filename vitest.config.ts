/**
 * Frontend test workspace — `ui`, `client-admin`, `client-student`. Two
 * environments per package, kept as separate leaf projects (Vitest doesn't
 * allow nesting `projects` inside a referenced project, so "one config per
 * package with an inner node/jsdom split" isn't expressible — each
 * package×environment pair has to be its own top-level entry):
 *
 *   - `<pkg>:node` — no DOM. Pure logic: formatting, permission resolution,
 *     validation, arithmetic. `*.spec.ts`. A test here that imports React
 *     and tries to render fails outright — there is no `document` — and
 *     that's deliberate: it's the boundary between "logic" and "component"
 *     tests, enforced by the environment rather than a lint rule.
 *   - `<pkg>:jsdom` — component/hook tests with React Testing Library.
 *     `*.test.{ts,tsx}`.
 *
 * Path aliases below mirror each package's real `vite.config.ts`/
 * `tsconfig.json` `paths` by hand, rather than importing those files —
 * `vitest`'s own config loader bundles against a *different, nested* Vite
 * major (`vitest/node_modules/vite`) than the one `client-admin`/
 * `client-student`'s own `vite.config.ts` run against (root `vite`), and
 * importing one from the other breaks on a `defineConfig` interop error
 * across the version gap. The Vite plugins those files load (`@vitejs/
 * plugin-react`, `@tailwindcss/vite`) exist for dev/build — Fast Refresh,
 * the Tailwind CSS pipeline — neither of which a test run needs; esbuild
 * (already in Vite's default pipeline) transforms JSX on its own by
 * reading each package's `tsconfig.json` `jsx` setting.
 *
 * `server/vitest.config.ts` is untouched and unrelated — the server runs
 * its own Vitest invocation from `server/`, this file only covers the
 * frontend packages.
 */
import { resolve } from 'node:path';

import { defineConfig, mergeConfig } from 'vitest/config';

function frontendPackage(
  name: string,
  dir: string,
  alias: Record<string, string>,
  { nodeInclude, jsdomInclude }: { nodeInclude: string[]; jsdomInclude: string[] },
) {
  const base = { resolve: { alias } };
  return [
    mergeConfig(base, {
      test: {
        name: `${name}:node`,
        root: dir,
        environment: 'node',
        include: nodeInclude,
        globals: true,
      },
    }),
    mergeConfig(base, {
      test: {
        name: `${name}:jsdom`,
        root: dir,
        environment: 'jsdom',
        include: jsdomInclude,
        globals: true,
      },
    }),
  ];
}

const uiAlias = {
  '@': resolve(__dirname, 'ui/src'),
  '@beton-boi/shared': resolve(__dirname, 'shared/src'),
};

const clientAlias = (pkg: string) => ({
  '@': resolve(__dirname, `${pkg}/src`),
  '@beton-boi/shared': resolve(__dirname, 'shared/src'),
  '@beton-boi/ui/components': resolve(__dirname, 'ui/src/components/index.ts'),
  '@beton-boi/ui/shells': resolve(__dirname, 'ui/src/shells/index.ts'),
  '@beton-boi/ui/hooks': resolve(__dirname, 'ui/src/hooks/index.ts'),
  '@beton-boi/ui/utils': resolve(__dirname, 'ui/src/utils/index.ts'),
  '@beton-boi/ui/i18n': resolve(__dirname, 'ui/src/i18n/index.ts'),
  '@beton-boi/ui/api': resolve(__dirname, 'ui/src/api/index.ts'),
  '@beton-boi/ui/test': resolve(__dirname, 'ui/src/test/index.ts'),
  '@beton-boi/ui': resolve(__dirname, 'ui/src'),
});

export default defineConfig({
  test: {
    projects: [
      ...frontendPackage('ui', 'ui', uiAlias, {
        // eslint-rules specs are ESLint RuleTester fixtures, not app logic,
        // but they're plain-Node tests with no DOM need either — same
        // bucket as everything else in the node project.
        nodeInclude: ['src/**/*.spec.ts', 'eslint-rules/**/*.spec.mjs'],
        jsdomInclude: ['src/**/*.test.{ts,tsx}'],
      }),
      ...frontendPackage('client-admin', 'client-admin', clientAlias('client-admin'), {
        nodeInclude: ['src/**/*.spec.ts'],
        jsdomInclude: ['src/**/*.test.{ts,tsx}'],
      }),
      ...frontendPackage('client-student', 'client-student', clientAlias('client-student'), {
        nodeInclude: ['src/**/*.spec.ts'],
        jsdomInclude: ['src/**/*.test.{ts,tsx}'],
      }),
    ],
  },
});
