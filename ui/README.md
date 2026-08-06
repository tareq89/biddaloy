# `@beton-boi/ui`

The shared React component package. Every biddaloy SPA — `client-admin`,
`client-student`, `client-teacher` — imports its UI from here and builds none of
its own.

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
| `src/i18n/` | i18next setup and per-tenant region configuration. |
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
with a fresh, retry-disabled `QueryClient` per call. See the root
`vitest.config.ts` for the node/jsdom project split this runs under, and
`src/test/render-with-providers.tsx`'s own doc comments for the full option
list (`tenantId`/`role`/`accessToken`, `seedQueries`, a caller-supplied
`queryClient`).

**No router or i18n provider yet.** Neither exists anywhere in this repo:
TanStack Router lands in [8.9.1], TanStack Query's *app* defaults (as
opposed to `renderWithProviders`'s test-only ones) in [8.9.2], i18next in
[8.7.1]. Adding `initialRoute`/`locale` options to `renderWithProviders`
now would mean either installing that infrastructure ahead of its own
dedicated ticket, or shipping options that silently do nothing — both
worse than being explicit that they're not here yet. The options object is
structured so adding them later is additive (new fields, the internal
`Wrapper` gains another layer), not a breaking change to the function's
signature. The intended eventual shape:

```
renderWithProviders
 ├── QueryClientProvider   (here today)
 ├── RouterProvider        ([8.9.1])
 └── I18nextProvider       ([8.7.1])
```

Auth/tenant/role state (`ui/src/api/auth-state.ts`) is a module-scoped
singleton, not per-render state, so it can't be reset just by creating a
fresh `QueryClient` the way the rest of `renderWithProviders`'s state is.
`renderWithProviders` exports a plain `cleanupTestState()` function for
this — deliberately *not* a global `afterEach` registered as an import
side effect of that module, since anyone importing `renderWithProviders`
would then implicitly change the whole test run's lifecycle. `src/test/
setup.ts` is the one place that wires `cleanupTestState` into `afterEach`,
via `vitest.config.ts`'s `setupFiles`.

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
test that looks green while testing nothing. `handlers` (currently empty;
[8.4.2] populates it with the typed handler library) is the shared
baseline every test starts with; `server.use()` layers a per-test
override on top, cleared automatically by the next test's `resetHandlers`.

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

None of `useStudent`, `useDebounce`/`useThrottle`-style hooks, or `useOnline`
exist in `src/hooks/` yet — every hook named below is a small, ad-hoc
stand-in defined directly in `src/test/render-hook-with-providers.test.tsx`,
there only to prove these test utilities work correctly. Treat the examples
as usage patterns, not as pointers to real exports.

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
