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

Everything it writes is vendored: regenerate it, never hand-edit it. If a
primitive genuinely needs a change that cannot live in its wrapper under
`src/components/`, record why in a comment at the top of the vendored file —
`--overwrite` replaces file contents wholesale, so an undocumented change is
silently discarded the next time someone regenerates. See
`src/primitives/README.md` for the same rule in more detail, plus the
coverage-exclusion note.

## Scripts

| Command | Purpose |
|---|---|
| `yarn workspace @beton-boi/ui lint` | `tsc --noEmit` |
| `yarn workspace @beton-boi/ui check:exports` | Validate the `exports` map against disk |
| `yarn workspace @beton-boi/ui check:contrast` | Verify every documented colour pair against WCAG 2.2 |
