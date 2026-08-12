# beton-boi Architecture Docs

This is the source of truth for how beton-boi is actually built. It replaces
the old `.hermes/plans/` planning documents — those captured the *original
vision* before the system existed; these docs describe *what was actually
built*, including every place implementation diverged from that original
plan (and why).

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
| [06-frontend-architecture.md](06-frontend-architecture.md) | Working in `ui/`, `client-admin/`, or `client-student/` |
| [07-deployment.md](07-deployment.md) | Working on Docker, nginx, CI, or production deploys |

For deep security/token/CSRF/versioning detail, the root [`README.md`](../../README.md)
is still the primary reference — these docs link out to it rather than
duplicating it.
