# Frontend Architecture

Three frontend packages, one strict rule about how they relate:

```mermaid
flowchart TB
    subgraph "ui/ (@beton-boi/ui)"
        PRIM["primitives/\n(raw Radix wrappers —\nButton, Dialog, Select, ...)"]
        COMP["components/\n(composed, opinionated —\nDataTable, FormField, DatePicker, ...)"]
        SHELL["shells/\n(page-level layout patterns —\nFormShell, ListShell, DetailShell, WizardShell)"]
        HOOKS["hooks/ + api/\n(TanStack Query hooks,\napiClient with token refresh)"]
        I18N["i18n/\n(i18next, lazy namespaces)"]
    end

    ADMIN["client-admin\n(staff/admin SPA)"]
    STUDENT["client-student\n(guardian/student SPA)"]

    ADMIN -->|"public subpaths only"| COMP
    ADMIN --> SHELL
    ADMIN --> HOOKS
    STUDENT -->|"public subpaths only"| COMP
    STUDENT --> SHELL
    STUDENT --> HOOKS

    ADMIN -.->|"BLOCKED by eslint\ncomponent-boundary rule"| PRIM
    STUDENT -.->|"BLOCKED by eslint\ncomponent-boundary rule"| PRIM
```

## The component boundary rule (enforced, not a convention)

`client-admin` and `client-student` may **only** import from
`@beton-boi/ui`'s published subpaths — never Radix directly, never a deep
`ui/src/...` or `.../primitives/...` path, never a raw `Intl`/
`toLocaleString()` call in place of a shared formatter. This is enforced by
a custom ESLint rule (`ui/eslint-rules/component-boundary.mjs`), registered
only in the client apps' eslint configs — `ui/` itself is exempt, since its
own wrapper components are exactly the code that's supposed to reach into
Radix and primitives.

**Why this matters when you're adding a feature**: if you need a UI piece
that doesn't exist yet in `ui/components/`, build it _there_ and export it
through a public subpath — don't reach past the boundary from a client app,
even for "just this one case." The lint rule will fail CI if you do.

## `ui/` structure

| Folder           | What lives here                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `primitives/`    | Thin Radix wrappers (Button, Dialog, Select, Checkbox, Tooltip, Skeleton, …) — the only place allowed to `import { ... } from 'radix-ui'`                                                                                                                                                                                      |
| `components/`    | Composed, opinionated components built on primitives (DataTable, FormField, DatePicker, Combobox, FileUpload, Pagination, Menu, …)                                                                                                                                                                                             |
| `shells/`        | Reusable **page-level** layout patterns — `FormShell` (create/edit forms with autosave/draft-restore), `ListShell` (filterable/sortable lists), `DetailShell` (tabbed detail views), `WizardShell` (multi-step flows). Both client apps build their actual pages by composing these rather than laying out pages from scratch. |
| `hooks/`, `api/` | TanStack Query hooks (e.g. `useCreatePayment`) and the shared `apiClient` — including the access-token-refresh flow described in [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md)                                                                                                                                    |
| `i18n/`          | i18next setup with per-namespace lazy loading and locale persistence                                                                                                                                                                                                                                                           |
| `test/`          | Shared test factories and MSW request handlers, reused by both client apps' test suites                                                                                                                                                                                                                                        |

Storybook documents every `components/`/`primitives/` entry with stories;
Tailwind design tokens live in `tailwind.preset.ts`, checked for
WCAG contrast compliance by `ui/scripts/check-contrast.mjs` in CI.

## The financial-mutation guard (enforced, not a convention)

A second custom ESLint rule, `no-optimistic-financial-mutation`
(`ui/eslint-rules/financial-mutation.mjs`), blocks optimistic UI on any
`useMutation` call touching a payment or enrollment endpoint. Reasoning,
straight from the rule's own comment: showing "৳4,500 received" and then
rolling back on error means the UI confirmed a payment that didn't
happen — at a cash counter, with the parent standing there, that's not a
glitch, it's an argument. This is a lint rule specifically so it's caught
every time a mutation is added or edited, not just when someone remembers
to check for it in review.

**If you're building a form that touches money or enrollment status**:
don't add optimistic updates to its mutation. Show a pending state and wait
for the server response.

## Client apps

- **`client-admin`** — staff-facing: manages students/guardians/classes/fee
  structures/payments, sends reminders, views audit logs. Currently also
  serves teachers (no separate `client-teacher` app was built — see
  [00-overview.md](00-overview.md)).
- **`client-student`** — guardian/student self-service: view fees,
  enrollment, invoices.

Both are Vite + React 19 SPAs, both consume `@beton-boi/ui`, both are built
independently and served as static assets by the NestJS server in
production (see [00-overview.md](00-overview.md) for the system diagram).

## Testing

Vitest for unit/component tests (colocated `*.test.tsx`), Playwright for
end-to-end flows, MSW for mocking the API in both. Shared test factories
and handlers live in `ui/src/test/` so admin and student test suites build
fixtures the same way. See `ui/CONTRIBUTING.md` and `ui/README.md` for the
exact commands and CI gates.
