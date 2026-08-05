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

## Scripts

| Command | Purpose |
|---|---|
| `yarn workspace @beton-boi/ui lint` | `tsc --noEmit` |
| `yarn workspace @beton-boi/ui test` | Run the vitest suite |
| `yarn workspace @beton-boi/ui check:exports` | Validate the `exports` map against disk |
| `yarn workspace @beton-boi/ui check:contrast` | Verify every documented colour pair against WCAG 2.2 |
| `yarn workspace @beton-boi/ui check:api-types` | Verify `schema.d.ts` matches a fresh generation |
| `yarn workspace @beton-boi/ui api:types` | Regenerate `schema.d.ts` from `server/openapi.json` |
