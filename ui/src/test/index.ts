/**
 * Render helpers, MSW handlers, factories and accessibility matchers, shared by every SPA's test suite.
 *
 * MSW handlers are populated by a later phase-8 task ([8.4.x]).
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

export * from './factories';
export * from './a11y';
