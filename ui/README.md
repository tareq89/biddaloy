# `@beton-boi/ui`

The shared React component package. Every biddaloy SPA — `client-admin`,
`client-student`, `client-teacher` — imports its UI from here and builds none of
its own.

Adding or changing a component? See [`CONTRIBUTING.md`](CONTRIBUTING.md)
for the wrapper rule, the three-file requirement, and the PR checklist.

## Why this is separate from `@beton-boi/shared`

`shared` is consumed by the NestJS server and has to stay framework-agnostic.
Putting React in it would drag React into the server's dependency graph. `ui`
depends on `shared`; never the reverse.

## Consumed as source, not built

There is **no build step**. `package.json` points at `src/`, and consumers
resolve it through a Vite alias plus a tsconfig path — the same way
`client-student` already consumes `@beton-boi/shared`. That keeps HMR working
across package boundaries: editing a component re-renders the app immediately
instead of waiting on a library rebuild.

## Layout

| Directory | Contents |
|---|---|
| `src/primitives/` | Vendored shadcn/ui output. **Not exported.** Regenerate, never hand-edit. |
| `src/components/` | The public component surface — one wrapper per primitive. |
| `src/shells/` | The four page shells: List, Detail, Wizard, Form. |
| `src/hooks/` | URL state, pagination, permissions, auth, connectivity. |
| `src/utils/` | Formatters and helpers. All `Intl` use lives here. |
| `src/i18n/` | i18next setup and per-tenant region configuration — see its own [README](src/i18n/README.md) for the translator workflow and `check:i18n`. |
| `src/api/` | Generated OpenAPI types and the shared axios client. |
| `src/test/` | Render helpers, MSW handlers, factories, a11y matchers. |
| `src/styles/` | `globals.css` — imported once per app. |

## The one rule

SPAs import from `@beton-boi/ui/*` and never from `@radix-ui/*` or
`src/primitives/`. A primitive reached directly bypasses the accessibility,
i18n and formatting defaults its wrapper exists to provide — so one app quietly
behaves differently from the other three.

`yarn check:exports` enforces the boundary; lint rules in [8.2.3] enforce it
from the consuming side.

## Generating primitives

`ui/components.json` points the shadcn CLI at `src/primitives/` and nothing
else — run it from `ui/`:

```bash
npx shadcn add button              # add a new primitive
npx shadcn add button --overwrite  # re-apply after an upstream update
```

Everything it writes is vendored — see `src/primitives/README.md` for the
regenerate-don't-edit rule, the coverage-exclusion note, and why every
`components.json` alias (`components`, `ui`, `lib`, `utils`, `hooks`) points
into `src/primitives/`, not just the one the CLI actually needs for a plain
component add.

## API client

`src/api/schema.d.ts` is generated from `server/openapi.json` — the frontend's
request/response types cannot drift from what the server actually serves.
Regenerate it after any server API change:

```bash
yarn workspace @beton-boi/ui api:types
```

`check:api-types` (wired into CI) fails if the checked-in file doesn't match a
fresh generation, so a forgotten regeneration is caught rather than silently
shipped stale.

`apiClient` (a configured axios instance) handles what every authenticated
request needs:

- **`X-Tenant-ID`** is attached from the active tenant, set via
  `setActiveTenant()`. A request made with no active tenant throws
  `NoActiveTenantError` before any network call — sending the wrong tenant
  silently reads another school's data, so this fails loudly instead.
- **`X-Role`** is attached only when `setActiveRole()` has been called —
  optional, used only to pick a non-default role for a multi-membership user.
- **401 handling** refreshes the access token exactly once per expired-token
  window and replays the original request. Concurrent 401s share a single
  refresh rather than each firing their own — the server treats a second
  refresh request presenting an already-rotated cookie as reuse outside its
  grace window and revokes the whole token family, so this isn't just an
  optimisation. A failed refresh clears auth state and calls whatever handler
  was registered via `registerSessionExpiredHandler()` — this package never
  imports a router itself, so the consuming app wires that to its own
  navigation.
- Server errors surface as a typed `ApiError` (`statusCode`, `message`,
  `requestId`), not a raw Axios error.

See `src/api/client.spec.ts` for the exact behaviour under test — single-flight
refresh, replay, and the give-up path are all exercised against a mocked HTTP
layer, not just unit-tested in isolation.

## Testing

`@beton-boi/ui/test` exports `renderWithProviders` — the one provider stack
every component test needs, wrapping a component in `QueryClientProvider`
and `I18nProvider` with a fresh, retry-disabled `QueryClient` per call. See
the root `vitest.config.ts` for the node/jsdom project split this runs
under, and `src/test/render-with-providers.tsx`'s own doc comments for the
full option list (`tenantId`/`role`/`accessToken`, `seedQueries`, a
caller-supplied `queryClient`, `locale`).

**Still no router in `renderWithProviders` itself, and no app-wide router
yet** — that's a later ticket's call (TanStack Query's *app* defaults, as
opposed to `renderWithProviders`'s test-only ones, land in [8.9.2]). i18next
landed in [8.7.1]: every render now suspends on translated content until
its namespace resolves, same as the real app, and a `locale` option picks
which language a given render exercises. Since i18next is a
module-scoped singleton (like `auth-state.ts`), `cleanupTestState()` resets
the active language back to the default between tests, same as it already
does for auth/tenant/role. The options object is structured so a router
lands additively later (a new field, the internal `Wrapper` gains another
layer), not as a breaking change to the function's signature:

```text
renderWithProviders
 ├── QueryClientProvider   (here today)
 ├── I18nProvider          (here today — [8.7.1])
 └── RouterProvider        (app-wide adoption — a later ticket's call)
```

**Routing is a narrower story**: [8.4.5] added a *scoped* integration
harness — `react-router`, `renderWithRouter`, `RequireRole`,
`useListUrlState` — not the app-wide router `renderWithProviders`'s own
diagram above still leaves open. See `### Routing` below for what exists
today and how it's deliberately bounded.

Auth/tenant/role state (`ui/src/api/auth-state.ts`) is a module-scoped
singleton, not per-render state, so it can't be reset just by creating a
fresh `QueryClient` the way the rest of `renderWithProviders`'s state is.
`renderWithProviders` exports a plain `cleanupTestState()` function for
this — deliberately *not* a global `afterEach` registered as an import
side effect of that module, since anyone importing `renderWithProviders`
would then implicitly change the whole test run's lifecycle. `src/test/
setup.ts` is the one place that wires `cleanupTestState` into `afterEach`,
via `vitest.config.ts`'s `setupFiles`.

### Routing

"Page, filters, sort, selected row and active tab all live in the query
string" is a core platform principle, and [8.4.5] built the integration
harness that proves it holds — not the app-wide router itself, which is a
later ticket's call and may or may not end up being the same library.
`react-router` is a real, installed dependency (not test-only — `RequireRole`
is meant to be consumed by actual routes once they exist), scoped narrowly
to what this ticket needs.

`renderWithRouter(routes, options)` (`@beton-boi/ui/test`) is
`renderWithProviders`'s router-aware sibling — same
`tenantId`/`role`/`accessToken`/`queryClient` options, plus `initialEntries`
(mount at an arbitrary URL, search params included) and `initialIndex`
(seed history *before* the entry under test, so back-navigation has
something real to return to). It takes a `RouteObject[]` — react-router's
own route-config shape — rather than a single element, so a test exercises
real route matching, not one component in isolation:

```tsx
const { router } = renderWithRouter(
  [{ path: '/students', element: <StudentsListRoute /> }],
  { initialEntries: ['/students?page=2&class_id=class-9'], tenantId: 'tenant-1' },
);
// router.state.location — assert the URL, not just what rendered
// router.navigate(-1) — simulate Back (wrap in `act()`, it's async)
```

`useListUrlState(defaults?)` (`@beton-boi/ui/routes`) is the one hook a
list page should read/write `page`/`limit`/`sort`/filters through — a thin,
typed wrapper over react-router's own `useSearchParams`. Falls back to
sensible defaults for a non-numeric, negative, or missing `page`/`limit`
rather than propagating `NaN` or a negative offset into a query — the same
malformed-URL problem the AC calls out (a stale bookmark, a hand-edited
link, a bug upstream):

```tsx
const [state, updateUrl] = useListUrlState({ limit: 10 });
// state.page / state.limit / state.sort / state.filters
updateUrl({ page: state.page + 1 });          // ?page=2
updateUrl({ filters: { class_id: 'c-9' } });  // ?class_id=c-9, page/sort untouched
```

`RequireRole` (`@beton-boi/ui/routes`) gates a route element by the active
role (`getActiveRole()`, the same value `apiClient` sends as `X-Role`),
redirecting to `/forbidden` (configurable) with `replace` — the guarded
route never enters back-navigation history:

```tsx
{ path: '/reports', element: (
  <RequireRole allow={['ADMIN', 'ACCOUNTANT', 'EXECUTIVE']}>
    <ReportsPage />
  </RequireRole>
) }
```

**This is UX, not the security boundary** — the server's own
`AuthGuard('jwt')`/`ContextGuard`/`RolesGuard` stack (see the root
`README`'s "Adding a new controller" section) is what actually enforces
access. `RequireRole` only avoids flashing a page the API would reject
anyway; a caller who bypasses it still hits the same 401/403 the server
always returns.

See `src/routes/router-integration.test.tsx` for the full reference —
mounting at an arbitrary URL, filter/sort/page changes asserted against
`router.state.location`, permission redirects checked across
accountant/teacher/executive, back-navigation restoring prior list state,
and a malformed `page` param falling back instead of crashing.

### Mocking (MSW)

`server` (MSW's Node runtime) is exported from `@beton-boi/ui/test` and
already wired into `src/test/setup.ts` — `listen({ onUnhandledRequest:
'error' })` in `beforeAll`, `resetHandlers()` in `afterEach`, `close()` in
`afterAll`. Nothing to import for the lifecycle itself; `server.use(...)`
inside a test is a complete per-test override on its own:

```ts
import { http, HttpResponse } from 'msw';
import { server } from '@beton-boi/ui/test';

it('handles a 500 from the students endpoint', async () => {
  server.use(http.get('/api/v1/students', () => HttpResponse.json(null, { status: 500 })));
  // ...
});
```

`onUnhandledRequest: 'error'` means a request with no matching handler
*throws* rather than hanging until timeout or silently passing through to
a real network call — silent pass-through is what produces an integration
test that looks green while testing nothing. `handlers` is the shared
baseline every test starts with — one hand-written, typed default handler
per API endpoint (`ui/src/test/msw/handlers/*.ts`, one file per resource
group), covering every path in `ui/src/api/schema.d.ts`. `server.use()`
layers a per-test override on top, cleared automatically by the next
test's `resetHandlers`.

Handlers are **hand-written, not generated** from the OpenAPI spec — a
deliberate choice: generated handlers tend to produce unrealistic data,
and the contract-drift risk they're meant to solve is already covered by
`tsc` breaking here if a path or response shape changes underneath a
handler. Response bodies are built from `@beton-boi/ui/test`'s factories
(`studentFactory()`, `paymentFactory()`, ...), not hand-rolled objects, so
mocked data looks like real data (Bangla names, BD phone numbers, lakh/
crore-scale money) without every handler re-deriving that itself.

A few endpoints' 2xx bodies are typed `content?: never` in `schema.d.ts`
— the controller never attached an `@ApiResponse` type, not because the
runtime shape differs — so those handlers are typed by hand against the
DTO the server module actually returns (each affected handler file notes
which). `ui/src/test/msw/support.ts` holds the shared plumbing every
handler builds on:

- **`paginate(items, url)`** reads `page`/`limit` off the request URL the
  same way every list endpoint does, and returns the
  `{ data, total, page, limit, totalPages }` envelope every list endpoint
  uses.
- **`errorHandler(method, path, status, message?)`** and **`slowHandler
  (method, path, resolver, ms?)`** are composable overrides for "what if
  this fails" / "what if this is slow" — rather than a hand-duplicated
  `*Error`/`*Slow` variant per endpoint (40+ endpoints × several variants
  each), a test reaches for these directly:
  `server.use(errorHandler('get', '/api/v1/students', 500))` or
  `server.use(slowHandler('get', '/api/v1/students', someResolver, 2000))`.
- **`tenantEchoHandler(method, path)`** reports back whatever `X-Tenant-ID`/
  `X-Role` a real request actually sent, for asserting the client attached
  them correctly: `server.use(tenantEchoHandler('get', '/api/v1/probe'))`,
  then assert on the response body.

`authHandlers` (`ui/src/test/msw/handlers/auth.ts`) additionally exports
named variants for login/refresh failure — `authHandlers.
loginInvalidCredentials`, `authHandlers.refreshFailure` — since those
encode genuinely different server behavior, not just a different status
code on the same success path. "Token expiry" isn't a separate handler:
`ui/src/api/client.ts`'s response interceptor already treats any
protected endpoint's 401 as a signal to refresh and retry once, so that
scenario is exercised by pairing `errorHandler(..., 401, ...)` on a
protected endpoint with either `authHandlers.refresh` (session recovers)
or `authHandlers.refreshFailure` (session actually ends).

Each resource's `*Handlers` object (`studentHandlers`, `feeHandlers`,
`invoiceHandlers`, ...) is exported from `@beton-boi/ui/test` alongside
the aggregate `handlers` array, so a test can reach for a specific named
variant — e.g. `studentHandlers.listEmpty` for the empty-list case —
without hand-writing one.

For running an SPA against mocks with no backend, `enableMocking()` from
`@beton-boi/ui/mocks` (a **separate** subpath from `@beton-boi/ui/test`,
on purpose — see below) starts MSW's browser worker when
`VITE_USE_MOCKS=true` is set, and no-ops otherwise:

```tsx
// main.tsx
import { enableMocking } from '@beton-boi/ui/mocks';

function renderApp() {
  createRoot(document.getElementById('root')!).render(<App />);
}

// The .catch() matters: worker.start() can reject for reasons that have
// nothing to do with this app (insecure context, browser blocking
// service workers, mockServiceWorker.js 404ing under the base path) —
// without it, renderApp() never runs and the page stays blank.
void enableMocking()
  .catch((error) => console.error('[enableMocking] failed — continuing without it', error))
  .then(renderApp);
```

A few things worth knowing if you touch this:

- **`@beton-boi/ui/mocks` uses a dynamic `import()` internally, not a
  static one.** A static `import { worker } from './browser'` at the top
  of `enable-mocking.ts` would pull `msw` (and its own dependencies,
  `@mswjs/interceptors`, `graphql`, ...) into *every* production bundle
  regardless of whether the flag is ever set — measured at ~280 KB raw
  (~92 KB gzipped) added to client-admin's bundle before this was fixed.
  With the flag check first and the import second, Vite's build-time
  `import.meta.env.VITE_USE_MOCKS` replacement turns the unset case into
  dead code, and Rollup drops the whole chunk from the production build.
- **The mock worker passes all WebSocket connections through to their
  real destination by default** (`ws.link('*')` + `server.connect()` in
  `browser.ts`). Without this, Vite's own HMR client — which connects
  over `ws://` — gets treated as an "unhandled connection" under the same
  `onUnhandledRequest: 'error'` policy and floods the console (verified
  by running client-admin with `VITE_USE_MOCKS=true` before adding the
  passthrough). `onUnhandledRequest` only ever governs HTTP requests; it
  was never a WebSocket setting, so this passthrough isn't a workaround
  for that option, it's the thing that option doesn't cover. It's
  registered *after* `handlers` in `setupWorker(...handlers, wsPassthrough)`,
  not before — MSW matches handlers in array order and stops at the first
  match, so a wildcard listed first would swallow every WebSocket
  connection before a future, more specific `ws.link(...)` handler in
  `handlers` ever got a chance to run.
- **`client-admin/public/mockServiceWorker.js` and `client-student/
  public/mockServiceWorker.js` are generated files, checked into the
  repo, not hand-written.** They embed their own MSW version
  (`PACKAGE_VERSION`) and can drift from whatever `msw` version is
  actually installed after an upgrade. Regenerate both after bumping
  `msw`:

  ```bash
  npx msw init client-admin/public --save
  npx msw init client-student/public --save
  ```

  (`--save` also refreshes `msw.workerDirectory` in the root
  `package.json`, which is already configured for both paths.)

### Hooks

`useStudent`/`useStudents`/`useCreateStudent` (`src/hooks/students.ts`) are
real, exported from `@beton-boi/ui/hooks` — the reference implementation for
the query cache/invalidation conventions below. `useDebounce`/`useThrottle`-
style hooks and `useOnline` don't exist yet; those examples below are still
small, ad-hoc stand-ins defined directly in
`src/test/render-hook-with-providers.test.tsx`, there only to prove the test
utilities work correctly — treat those two as usage patterns, not pointers to
real exports.

#### Query keys, invalidation, and cache-clearing

Every entity's query keys follow the same hierarchical shape, built by
`createEntityKeys()` (`src/hooks/query-keys.ts`):

```ts
export const studentKeys = createEntityKeys<StudentListFilters>('students');
// studentKeys.all        -> ['students']
// studentKeys.lists()    -> ['students', 'list']
// studentKeys.list(f)    -> ['students', 'list', { page: 1 }]
// studentKeys.details()  -> ['students', 'detail']
// studentKeys.detail(id) -> ['students', 'detail', id]
```

The hierarchy is what makes invalidation precise. A mutation that can affect
*any* list variant — a new student might match a filter the caller isn't
currently looking at — invalidates the whole `lists()` branch, not one
specific `list(filters)`:

```ts
export function useCreateStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStudentInput) => apiClient.post<Student>('/students', input),
    retry: shouldRetryQuery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: studentKeys.lists() });
    },
  });
}
```

New entities' hooks should mirror `students.ts`'s shape — `createEntityKeys()`
for the key factory, `shouldRetryQuery` (below) for retry, invalidate
`lists()` (not a single `list(filters)`) from any mutation that can affect
list membership.

**Retry**: `src/hooks/retry.ts`'s `shouldRetryQuery` is the one retry
predicate every query/mutation in this package should pass. A 4xx means the
request was rejected for a reason retrying can't fix (bad input, a role the
caller doesn't hold, a duplicate) — retrying just repeats the same rejection.
Anything else gets up to two retries:

```ts
useQuery({ queryKey: studentKeys.list(filters), queryFn: ..., retry: shouldRetryQuery });
```

Note that `createTestQueryClient()` (used by `renderWithProviders`/
`renderHookWithProviders`) sets `queries.retry: false` at the *client* level
for fast test failures — see the "Testing" section above. A per-query
`retry: shouldRetryQuery` option still overrides that client default, so
retry behaviour is still testable; a test asserting on it should also pass a
custom `QueryClient` with `retryDelay: 0` (TanStack's default is exponential
backoff in whole seconds, far too slow for a test) — see
`src/hooks/students.test.tsx`'s `retryTestClient()` for the pattern.

**Tenant switching**: `src/hooks/tenant.ts`'s `switchActiveTenant(queryClient,
tenantId, role?)` is the one blessed way to change the active tenant. Calling
`setActiveTenant()` (from `@beton-boi/ui/api`) directly leaves every cached
query keyed under the previous tenant sitting in the cache — nothing in
`auth-state.ts` clears it, since that module is deliberately state-management-
agnostic and holds no `QueryClient` reference. Left uncleared, switching
schools can render one school's cached students/fees/invoices under the new
tenant's name for however long `staleTime` allows. `switchActiveTenant` calls
`queryClient.clear()` — every cached query in this app is tenant-scoped
server state, so a full clear rather than a targeted invalidation is both
correct and doesn't need updating as more entities' hooks get added:

```ts
switchActiveTenant(queryClient, nextTenantId);
// queryClient.getQueryCache().getAll() is now empty
```

#### Optimistic updates — and where they're forbidden

Optimistic UI (show the new state immediately, roll back on failure) is fine
for a low-stakes mutation. It is **dangerous for anything financial**:
showing "৳4,500 received" and then rolling back means the UI confirmed a
parent's payment that didn't happen. At a cash counter, with the parent
standing there, that's not a glitch — it's an argument. Enrolment changes
carry the same risk: a rolled-back class transfer briefly shows a student in
a class they aren't in.

**The rule, enforced by lint, not just written down here**: `useMutation`
calls that post to `/payments/*`, `/fees/generate`, `/invoices`, or
`/enrollments/*` must never declare `onMutate`. The
`no-optimistic-financial-mutation` ESLint rule
(`eslint-rules/financial-mutation.mjs`, wired into every package's config —
`ui` itself included, since that's where these hooks actually live) fails
the build if the two ever appear on the same `useMutation` call. It's a
CI failure, not a review comment, for the same reason the
`@beton-boi/ui` import boundary is: review catches this sometimes, lint
catches it every time.

`src/hooks/payments.ts`'s `useCreatePayment` is the reference **non-**
optimistic mutation — no `onMutate`, only `isPending`/`isSuccess`/`isError`
to drive the UI:

```ts
export function useCreatePayment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePaymentInput) => apiClient.post<Payment>('/payments', input),
    retry: shouldRetryQuery,
    onSuccess: (payment) => {
      // The whole `lists()` branch — a new payment can affect an
      // unfiltered list or one filtered a different way too.
      void queryClient.invalidateQueries({ queryKey: paymentKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: studentKeys.detail(payment.student.id) });
    },
  });
}
```

A consuming form should disable its submit control on `mutation.isPending`
and keep whatever the user typed on `mutation.isError` — don't clear or
reset form state until `onSuccess` actually fires. See
`src/hooks/payments.test.tsx`'s `PaymentForm` for the full reference pattern
(a local, test-only component — no real `Input` primitive exists yet, see
epic 8.6).

`src/hooks/students.ts`'s `useUpdateStudentPreferredCommunication` is the
reference **legitimate** optimistic mutation — a guardian's contact
preference has none of a payment's stakes, so it's safe to show before the
server confirms. The three-part pattern every optimistic mutation needs:

```ts
useMutation({
  // Serializes calls for the *same* student — without it, two updates
  // fired close together can each snapshot before either resolves, and
  // whichever settles last rolls back over the other's already-applied
  // result. Two different students still run concurrently; they share
  // no cache entry to race over.
  scope: { id: `student-preferred-communication-${id}` },
  mutationFn: (value) => apiClient.patch(`/students/${id}`, { preferred_communication: value }),
  onMutate: async (value) => {
    await queryClient.cancelQueries({ queryKey: studentKeys.detail(id) });
    const previousStudent = queryClient.getQueryData(studentKeys.detail(id));
    queryClient.setQueryData(studentKeys.detail(id), { ...previousStudent, preferred_communication: value });
    return { previousStudent }; // rollback snapshot
  },
  onError: (_err, _value, context) => {
    queryClient.setQueryData(studentKeys.detail(id), context.previousStudent); // exact rollback
  },
  onSettled: () => {
    void queryClient.invalidateQueries({ queryKey: studentKeys.detail(id) }); // reconcile either way
  },
});
```

`renderHookWithProviders` mirrors `renderWithProviders`'s options
(`tenantId`/`role`/`accessToken`, `seedQueries`, a caller-supplied
`queryClient`), wrapping RTL's own `renderHook` instead of `render`. Same
per-call-fresh-`QueryClient` default; `initialProps`/`rerender(newProps)`
pass straight through for a hook that reacts to its argument changing:

```tsx
const { result, rerender } = renderHookWithProviders(({ id }: { id: string }) => useStudent(id), {
  tenantId: 'tenant-1',
  initialProps: { id: 'student-1' },
});
rerender({ id: 'student-2' });
```

Debounce/throttle-style hooks are testable with vitest's own fake timers —
no bespoke helper needed, just `vi.useFakeTimers()` and
`act(() => vi.advanceTimersByTime(ms))` around the render, wrapping timer
advances in `act()` so React flushes the resulting state update before the
next assertion. See `src/test/render-hook-with-providers.test.tsx` for a
working example against a debounce and a throttle hook.

`mockOnlineStatus(online)` mocks `navigator.onLine` for `useOnline`-style
hooks and dispatches the matching `online`/`offline` window event — jsdom's
`navigator.onLine` has no setter, so a plain assignment silently no-ops.
Resets automatically between tests via `setup.ts`.

### Accessibility

`expect(container).toHaveNoViolations()` is registered globally — every
project's `setupFiles` loads it via `src/test/setup.ts`, so no component
test needs its own `expect.extend` call. It runs [axe-core](https://github.com/dequelabs/axe-core)
against the container and fails with the offending node, the rule that
fired, and its help URL. `color-contrast` is disabled by default: jsdom has
no real layout/paint engine, so that check can't produce a meaningful
result under it — a real browser or visual-regression tool covers that
axis instead.

```tsx
const { container } = render(<MyForm />);
await expect(container).toHaveNoViolations();
```

`expectKeyboardOperable(element, options?)` asserts an element is reachable
by pressing Tab and that its activation keys (default `BUTTON_KEYS`, i.e.
Enter and Space) activate it. For a native `<button>` that's all you need —
it dispatches a real `click` on its own for both keys. A native `<a href>`
link only activates on **Enter** — Space scrolls the page instead, per the
HTML/WAI-ARIA spec — so pass `LINK_KEYS`:

```tsx
render(<a href="/students">Students</a>);
await expectKeyboardOperable(screen.getByRole('link'), { keys: LINK_KEYS });
```

For a custom `role="button"` widget, pass the spy already wired to its
activation handler via `onActivate`, since such a widget typically calls
its handler directly rather than dispatching a `click` Event:

```tsx
const onActivate = vi.fn();
render(<CustomButton onClick={onActivate}>Save</CustomButton>);
await expectKeyboardOperable(screen.getByRole('button'), { onActivate });
```

`expectTabOrder(elements)` asserts Tab visits a list of elements in exactly
that order — for verifying a form or toolbar's tab sequence, not just that
each element is individually reachable.

Both live in `src/test/a11y/` and are exported from `@beton-boi/ui/test`.
When [8.6.10]'s component contribution guide exists, it should link here
rather than duplicate this section.

## Scripts

| Command | Purpose |
|---|---|
| `yarn workspace @beton-boi/ui lint` | `tsc --noEmit` |
| `yarn workspace @beton-boi/ui test` | Run the vitest suite |
| `yarn workspace @beton-boi/ui check:exports` | Validate the `exports` map against disk |
| `yarn workspace @beton-boi/ui check:contrast` | Verify every documented colour pair against WCAG 2.2 |
| `yarn workspace @beton-boi/ui check:api-types` | Verify `schema.d.ts` matches a fresh generation |
| `yarn workspace @beton-boi/ui api:types` | Regenerate `schema.d.ts` from `server/openapi.json` |
