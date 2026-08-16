/**
 * Render helpers, MSW handlers, factories and accessibility matchers, shared by every SPA's test suite.
 *
 * `server` (MSW's Node runtime) is exported here; `worker` (MSW's browser
 * runtime, from `./msw/browser`) deliberately is not — `setupWorker()`
 * throws immediately when constructed outside a real browser, so bundling
 * it into this barrel would break every Node/jsdom test that imports
 * anything from `@biddaloy/ui/test` at all. It's reachable on its own,
 * browser-only subpath instead: `@biddaloy/ui/mocks`.
 *
 * `toHaveNoViolations()` is registered globally at runtime via `setup.ts`
 * (every project's `setupFiles`, so it works whether or not a test file
 * imports anything from here). The side-effect import below is only for
 * *type-checking* across package boundaries: `setup.ts` isn't part of
 * `client-admin`/`client-student`'s own TS program (their tsconfig only
 * includes their own `src`), so without this, `toHaveNoViolations`
 * type-checks in `ui` but not in a consuming SPA unless that file already
 * imports something else from `@biddaloy/ui/test` — which pulls this
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

export {
  renderWithRouter,
  type RenderWithRouterOptions,
  type RenderWithRouterResult,
} from './render-with-router';

export { mockOnlineStatus, resetOnlineStatus } from './connectivity';

export { server } from './msw/server';
export { handlers } from './msw/handlers';

export {
  apiErrorBody,
  errorHandler,
  paginate,
  slowHandler,
  tenantEchoHandler,
  requestContext,
  TENANT_HEADER,
  ROLE_HEADER,
  type ApiErrorBody,
  type Paginated,
} from './msw/support';

export { authHandlers, loginResponseFactory } from './msw/handlers/auth';
export { academicYearHandlers } from './msw/handlers/academic-years';
export { classHandlers } from './msw/handlers/classes';
export { enrollmentHandlers } from './msw/handlers/enrollments';
export { userHandlers } from './msw/handlers/users';
export { teacherHandlers } from './msw/handlers/teachers';
export { studentHandlers } from './msw/handlers/students';
export { guardianHandlers } from './msw/handlers/guardians';
export { feeStructureHandlers, feeHandlers } from './msw/handlers/fees';
export { paymentHandlers } from './msw/handlers/payments';
export { invoiceHandlers } from './msw/handlers/invoices';
export { communicationHandlers } from './msw/handlers/communications';
export { auditLogHandlers } from './msw/handlers/audit-logs';
export { schoolsHandlers, resetSchoolsStore } from './msw/handlers/schools';

export * from './factories';
export * from './a11y';
