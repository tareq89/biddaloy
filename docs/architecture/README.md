# Biddaloy Architecture Docs

This is the source of truth for how Biddaloy is actually built. It replaces
the old planning documents from before the system existed — those captured
the *original vision*; these docs describe *what was actually built*,
including every place implementation diverged from that original plan (and
why).

Each file below is self-contained — read only the one you need for the task
at hand instead of loading the whole set.

| Doc | Read this when you're... |
|---|---|
| [00-overview.md](00-overview.md) | Getting oriented, or need the big picture / tech stack / what changed from the original plan |
| [01-domain-model.md](01-domain-model.md) | Touching any database entity, or need to understand how the data model fits together |
| [02-auth-and-multitenancy.md](02-auth-and-multitenancy.md) | Working on login, tokens, roles, permissions, or anything tenant-scoped |
| [03-backend-modules.md](03-backend-modules.md) | Adding/changing a NestJS module, controller, or API route |
| [04-fees-payments-invoices.md](04-fees-payments-invoices.md) | Working on fee generation, payments, dues, or invoices — the core business flow |
| [05-communications.md](05-communications.md) | Working on SMS/WhatsApp/email/Messenger reminders |
| [06-frontend-architecture.md](06-frontend-architecture.md) | Working in `ui/` or `client-admin/` (the one SPA — staff routes + `/portal`) |
| [07-deployment.md](07-deployment.md) | Working on Docker, nginx, CI, or production deploys |
| [08-security.md](08-security.md) | Working on login, tokens, CSRF, audit logging, or PII/data-protection handling |
| [09-design-direction.md](09-design-direction.md) | Touching design tokens — type, colour, elevation, borders, density, motion. The approved values epic 8.13 (#343–#354) implements |

For practical "how do I run/develop/test this" instructions, see the root
[`README.md`](../../README.md) — these docs cover the *why* behind the
architecture, README covers the *how* of working in the repo day to day.
