/**
 * Frontend test workspace — `shared`, `ui`, `client-admin`. Two
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
 * major (`vitest/node_modules/vite`) than the one `client-admin`'s own
 * `vite.config.ts` runs against (root `vite`), and
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

// [15.1] Set only by ci.yml's per-job collect step (`CI_TIMINGS_OUT=<path>`
// on the test command's env). Unset — every local run, and every job that
// hasn't been wired up — means zero behaviour change: `reporters` below is
// simply omitted and Vitest keeps its own default. Verified: setting
// `test.reporters` at the *top level* of a `projects`-mode config works
// (unlike `testTimeout`, which projects silently ignore when set only at
// the top level — see PROJECT_TEST_TIMEOUT's own comment below).
const timingsOut = process.env.CI_TIMINGS_OUT;

// v8 coverage instrumentation adds real per-test overhead — enough that
// eslint-rules/component-boundary.spec.mjs's type-aware RuleTester cases
// (already the slowest tests here, since they run real TypeScript
// type-checking) went from ~700ms locally to timing out at the 5000ms
// default in CI once `--coverage` was wired in there ([8.3.5]). Not a
// flaky test — reproducible, coverage-only slowdown on a slower CI CPU.
// Set per-project (Vitest's `projects` mode does not inherit a top-level
// `test.testTimeout` into each project — a top-level setting here is
// silently ignored), applied to every project rather than just `ui:node`:
// harmless headroom elsewhere, and the one project that needs it doesn't
// get its own easy-to-forget bespoke value.
const PROJECT_TEST_TIMEOUT = 20_000;

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
        testTimeout: PROJECT_TEST_TIMEOUT,
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
        testTimeout: PROJECT_TEST_TIMEOUT,
      },
    }),
  ];
}

const uiAlias = {
  '@': resolve(__dirname, 'ui/src'),
  '@biddaloy/shared': resolve(__dirname, 'shared/src'),
};

const clientAlias = (pkg: string) => ({
  '@': resolve(__dirname, `${pkg}/src`),
  '@biddaloy/shared': resolve(__dirname, 'shared/src'),
  '@biddaloy/ui/components': resolve(__dirname, 'ui/src/components/index.ts'),
  '@biddaloy/ui/shells': resolve(__dirname, 'ui/src/shells/index.ts'),
  '@biddaloy/ui/hooks': resolve(__dirname, 'ui/src/hooks/index.ts'),
  '@biddaloy/ui/routes': resolve(__dirname, 'ui/src/routes/index.ts'),
  '@biddaloy/ui/utils': resolve(__dirname, 'ui/src/utils/index.ts'),
  '@biddaloy/ui/i18n': resolve(__dirname, 'ui/src/i18n/index.ts'),
  '@biddaloy/ui/api': resolve(__dirname, 'ui/src/api/index.ts'),
  '@biddaloy/ui/test': resolve(__dirname, 'ui/src/test/index.ts'),
  '@biddaloy/ui/mocks': resolve(__dirname, 'ui/src/test/msw/enable-mocking.ts'),
  '@biddaloy/ui': resolve(__dirname, 'ui/src'),
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
  include: ['ui/src/**/*.{ts,tsx}', 'client-admin/src/**/*.{ts,tsx}', 'shared/src/**/*.ts'],
  exclude: [
    '**/*.test.{ts,tsx}',
    '**/*.spec.ts',
    '**/*.stories.{ts,tsx}',
    '**/*.d.ts',
    'ui/src/primitives/**', // vendored shadcn/Radix output, not hand-written
    'ui/src/test/**', // the test utilities this coverage run itself uses
    // Barrels — assumed pure re-exports (`export { x } from './y'`), no
    // conditionals or logic of their own. If one ever grows real logic
    // (an env check, a conditional export), move that logic to its own
    // file instead of excluding it here by accident — this pattern stays
    // safe only as long as that assumption holds.
    '**/index.ts',
    '**/main.tsx', // ReactDOM bootstrap, no logic — same as server's src/main.ts
    'client-admin/src/routeTree.gen.ts', // generated by @tanstack/router-plugin, never hand-edited
    'client-admin/src/test/**', // test-only stubs, same rationale as ui/src/test/**
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
    coverage,
    ...(timingsOut ? { reporters: ['default', ['json', { outputFile: timingsOut }]] } : {}),
    projects: [
      ...frontendPackage('ui', 'ui', uiAlias, {
        // eslint-rules specs are ESLint RuleTester fixtures, and
        // scripts/**/*.spec.mjs covers the hand-rolled check-*.mjs CI
        // scripts (check-i18n-keys.mjs, ...) — neither is app logic, but
        // both are plain-Node tests with no DOM need either, same bucket
        // as everything else in the node project.
        nodeInclude: ['src/**/*.spec.ts', 'eslint-rules/**/*.spec.mjs', 'scripts/**/*.spec.mjs'],
        jsdomInclude: ['src/**/*.test.{ts,tsx}'],
      }),
      ...frontendPackage(
        'client-admin',
        'client-admin',
        {
          ...clientAlias('client-admin'),
          // `virtual:pwa-register` only exists inside a `vite-plugin-pwa`
          // build. Aliased to a stub so `pwa/register.ts` (and
          // `vi.mock()` of that id) resolves under test — see the stub's
          // own comment.
          'virtual:pwa-register': resolve(
            __dirname,
            'client-admin/src/test/virtual-pwa-register-stub.ts',
          ),
        },
        {
          nodeInclude: ['src/**/*.spec.ts'],
          jsdomInclude: ['src/**/*.test.{ts,tsx}'],
        },
      ),
      // `shared` is pure TypeScript with no DOM half — one node project
      // rather than the node/jsdom pair `frontendPackage` builds, since an
      // empty jsdom project would just fail the run with "no test files".
      {
        test: {
          name: 'shared:node',
          root: 'shared',
          environment: 'node',
          include: ['src/**/*.spec.ts'],
          globals: true,
          setupFiles: [testSetupFile],
          testTimeout: PROJECT_TEST_TIMEOUT,
        },
      },
      // [15.1] Root `scripts/` had no Vitest project before this — the
      // `ui:node` project above also matches `scripts/**/*.spec.mjs`, but
      // it's rooted at `dir: 'ui'` (see `frontendPackage`'s `nodeInclude`),
      // so that glob only ever resolved `ui/scripts/**/*.spec.mjs`. This
      // project is rooted at the repo root so hand-rolled CI scripts like
      // `scripts/ci-timings.mjs` get the same test coverage its `ui/scripts`
      // siblings (`check-i18n-keys.mjs`, `check-raw-palette.mjs`) already do.
      {
        test: {
          name: 'scripts:node',
          root: '.',
          environment: 'node',
          include: ['scripts/**/*.spec.mjs'],
          globals: true,
          setupFiles: [testSetupFile],
          testTimeout: PROJECT_TEST_TIMEOUT,
        },
      },
    ],
  },
});
