/**
 * Render helpers, MSW handlers, factories and accessibility matchers, shared by every SPA's test suite.
 *
 * `server` (MSW's Node runtime) is exported here; `worker` (MSW's browser
 * runtime, from `./msw/browser`) deliberately is not — `setupWorker()`
 * throws immediately when constructed outside a real browser, so bundling
 * it into this barrel would break every Node/jsdom test that imports
 * anything from `@beton-boi/ui/test` at all. It's reachable on its own,
 * browser-only subpath instead: `@beton-boi/ui/mocks`.
 *
 * `toHaveNoViolations()` is registered globally at runtime via `setup.ts`
 * (every project's `setupFiles`, so it works whether or not a test file
 * imports anything from here). The side-effect import below is only for
 * *type-checking* across package boundaries: `setup.ts` isn't part of
 * `client-admin`/`client-student`'s own TS program (their tsconfig only
 * includes their own `src`), so without this, `toHaveNoViolations`
 * type-checks in `ui` but not in a consuming SPA unless that file already
 * imports something else from `@beton-boi/ui/test` — which pulls this
 * import along with it.
 */
import './a11y/matchers';

export {
  cleanupTestState,
  createTestQueryClient,
  renderWithProviders,
  userEvent,
  type RenderWithProvidersOptions,
  type RenderWithProvidersResult,
  type SeedQuery,
} from './render-with-providers';

export {
  renderHookWithProviders,
  type RenderHookWithProvidersOptions,
  type RenderHookWithProvidersResult,
} from './render-hook-with-providers';

export { mockOnlineStatus, resetOnlineStatus } from './connectivity';

export { server } from './msw/server';
export { handlers } from './msw/handlers';

export * from './factories';
export * from './a11y';
