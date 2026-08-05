/**
 * Render helpers, MSW handlers, factories and accessibility matchers, shared by every SPA's test suite.
 *
 * MSW handlers, seeded Faker factories and vitest-axe matchers are
 * populated by later phase-8 tasks ([8.4.x], [8.3.3], [8.3.4]).
 */
export {
  cleanupTestState,
  createTestQueryClient,
  renderWithProviders,
  userEvent,
  type RenderWithProvidersOptions,
  type RenderWithProvidersResult,
  type SeedQuery,
} from './render-with-providers';
