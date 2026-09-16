/**
 * Unit test setup.
 *
 * Loaded by vitest's setupFiles mechanism, unit config only.
 *
 * [18.2.1] `vitest.unit.config.ts` sets `poolOptions.threads.isolate: false`
 * so unit files share a module registry and worker thread instead of each
 * getting a fresh one — much cheaper for ~16 files' worth of `vi.mock(...)`
 * calls across `src/**`, since there's no real database/Redis dependency to
 * isolate against (unlike integration/e2e). The cost of sharing is that
 * anything a test mutates on a shared module, mock, timer, or global leaks
 * into the next test/file unless something resets it — this file is that
 * reset, run after every single test regardless of which file it's in.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  // Drops every module from the shared registry a `vi.mock(...)` call
  // replaced, so the next test file's own `vi.mock(...)` factories apply
  // cleanly instead of reusing whatever the previous file last registered.
  vi.resetModules();
});
