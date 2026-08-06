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

// Resets renderWithProviders's singleton state (auth-state.ts today) after
// every test — see render-with-providers.tsx's own comment on why this
// lives in a dedicated setup file rather than as an import side effect of
// the helper module itself. Applied to every project, not just `:jsdom`:
// a node-tier test can call auth-state's setters directly (permission
// resolution, say) without ever touching renderWithProviders, and should
// get the same cleanup guarantee.
const testSetupFile = resolve(__dirname, 'ui/src/test/setup.ts');

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
        setupFiles: [testSetupFile],
      },
    }),
    mergeConfig(base, {
      test: {
        name: `${name}:jsdom`,
        root: dir,
        environment: 'jsdom',
        include: jsdomInclude,
        globals: true,
        setupFiles: [testSetupFile],
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

// Coverage config lives at this top level, not inside any one project:
// v8 instrumentation and threshold checking run once across the whole
// workspace's collected results, not per project — Vitest doesn't support
// per-project coverage in `projects` mode. Paths below are relative to
// this file (the repo root), covering all three packages' `src/` in one
// pass — `test:cov`'s reporter/threshold shape mirrors `server/
// vitest.config.ts`'s (per-path threshold overrides on top of a global
// floor), kept as a separate, un-merged block here since the two runs
// (frontend vs. server) share no config and `server/vitest.config.ts`
// itself stays untouched.
const coverage = {
  provider: 'v8' as const,
  reporter: ['text', 'lcov', 'html'] as const,
  reportsDirectory: resolve(__dirname, 'coverage'),
  include: ['ui/src/**/*.{ts,tsx}', 'client-admin/src/**/*.{ts,tsx}', 'client-student/src/**/*.{ts,tsx}'],
  exclude: [
    '**/*.test.{ts,tsx}',
    '**/*.spec.ts',
    '**/*.stories.{ts,tsx}',
    '**/*.d.ts',
    'ui/src/primitives/**', // vendored shadcn/Radix output, not hand-written
    'ui/src/test/**', // the test utilities this coverage run itself uses
    '**/index.ts', // barrels — re-exports only, nothing to branch on
    '**/main.tsx', // ReactDOM bootstrap, no logic — same as server's src/main.ts
  ],
  thresholds: {
    perFile: false,
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70,
    // "Near-complete" tier ([8.3.5]'s own acceptance criteria): a bug here
    // means money is wrong or a request goes out with the wrong auth
    // state. Only covers what actually exists in `ui/src` today —
    // `ui/src/utils` (formatters) and `ui/src/api` (the axios client,
    // its interceptors, and auth-state.ts). Permission-resolution logic,
    // payment-allocation arithmetic and Zod schemas are listed in the
    // issue too, but none of that exists on the frontend yet (it's
    // server-side today); extend this map with their real paths once a
    // later ticket adds them, rather than guessing now.
    'ui/src/utils/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
    'ui/src/api/**': { statements: 95, branches: 95, functions: 95, lines: 95 },
  },
};

export default defineConfig({
  test: {
    // v8 coverage instrumentation adds real per-test overhead — enough
    // that `eslint-rules/component-boundary.spec.mjs`'s type-aware
    // RuleTester cases (already the slowest tests here, since they run
    // real TypeScript type-checking) went from ~700ms locally to timing
    // out at the 5000ms default in CI once `--coverage` was wired in
    // there ([8.3.5]). Not a flaky test — reproducible, coverage-only
    // slowdown on a slower CI CPU. Applies to every project, not just
    // `ui:node`: harmless headroom elsewhere, and the one project that
    // needs it doesn't get its own bespoke timeout to remember.
    testTimeout: 20_000,
    coverage,
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
