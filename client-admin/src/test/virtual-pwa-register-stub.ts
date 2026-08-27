/**
 * Stands in for `virtual:pwa-register` under Vitest.
 *
 * That module is synthesised by `vite-plugin-pwa` during a real build and
 * does not exist on disk, so a test run cannot resolve the id — and
 * `vi.mock()` needs the id to resolve before it can replace it. The root
 * `vitest.config.ts` aliases `virtual:pwa-register` here for the
 * `client-admin` projects; tests then `vi.mock('virtual:pwa-register', …)`
 * as usual. Nothing ships this file.
 */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
