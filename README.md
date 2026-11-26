# SchoolManager
 
A multi-tenant school management system. Staff manage students, fees, payments and invoices; guardians and students use a self-service portal that also works offline.
 
A TypeScript monorepo: a **NestJS** API on **PostgreSQL**, and a **React** SPA, with a shared component library and shared types.
 
**[Docs](docs/architecture/)** · [Architecture overview](docs/architecture/00-overview.md) · [Quick start](#quick-start) · [Deploying](#deploying)
 
## Engineering highlights
 
- **Documented design.** Numbered architecture docs in [`docs/architecture/`](docs/architecture/) record why the system is built the way it is: domain model, multi-tenancy, fees/payments/invoices flow, security, deployment.
- **Type safety across the stack.** The API publishes OpenAPI; client types are generated from it, and CI fails if they drift.
- **Layered testing.** Unit, integration and server e2e tests run against real Postgres, Redis and S3-compatible storage. The frontend has 2,000+ tests with ~90% statement coverage and an enforced 80% floor (95% on the API client and money-handling utilities). About 500 Playwright specs run against a production build.
- **Offline-capable PWA.** A dedicated suite tests a real service worker: installability, offline navigation, update flow, queued mutations and per-tenant cache purging.
- **Disciplined CI.** Sharded parallel jobs, protected `main` with a merge queue, CodeQL, dependency audit, bundle-size budgets and nightly Lighthouse and cross-browser runs. `yarn ci:local` replays the pipeline on a laptop.
- **Evidence-driven quality work.** Flaky tests were classified from CI history rather than retried (no blanket retries; capped, expiring quarantine). PR time dropped from a ~34 min median to roughly 13-16 min, and the docs state what is still unproven.
- **Safe deploys.** CI publishes immutable images; servers only run those. Staging first, then production with the same commit. Ansible-managed infrastructure, encrypted secrets and a runbook for rollback and restore.
## Architecture
 
```
server/             NestJS API (TypeORM + PostgreSQL)
client-admin/       Vite + React SPA: staff routes + guardian /portal
ui/                 Shared React component package
shared/             Shared types and DTOs
docs/architecture/  Design docs
deploy/  infra/     Compose files, Ansible, encrypted secrets
```
 
- **One SPA, many audiences:** staff land on `/dashboard`, parents and students on `/portal`.
- **Services:** PostgreSQL for data, Redis for caching and queues, SeaweedFS for S3-compatible file storage.
- **Multi-tenant by school**, with a domain model built around fees, payments and invoices.
- **Contract-first API:** OpenAPI is the single source of truth between server and client.
### Architecture docs
 
The full design lives in [`docs/architecture/`](docs/architecture/). Start with the overview.
 
| Doc | Covers |
|---|---|
| [00 Overview](docs/architecture/00-overview.md) | System diagram and tech stack |
| [03 Backend modules](docs/architecture/03-backend-modules.md) | NestJS modules and OpenAPI generation |
| [07 Deployment](docs/architecture/07-deployment.md) | Shape of the deployment setup |
| [28 Platform runbook](docs/architecture/28-platform-runbook.md) | Day 0, releases, rollback, restore, secret rotation |
| [30 Deployment target](docs/architecture/30-deployment-target.md) | Why the deployment is built this way |
 
Frontend package details: [`ui/README.md`](ui/README.md).
 
## Quick start
 
Requires Node.js 24 (`nvm use`), Yarn 1.x and Docker.
 
```bash
yarn install
cp .env.example .env     # set DATABASE_URL and SEED_ADMIN_PASSWORD
yarn dev
```
 
Open <http://localhost:5174> and log in as `admin@school.com` with your `SEED_ADMIN_PASSWORD`. `yarn dev` starts the database, runs migrations, seeds the admin user and launches everything; it is safe to re-run.
 
| Goal | Command |
|---|---|
| Typecheck + lint + affected tests | `yarn run check` |
| Frontend tests | `yarn test:frontend` |
| Full server suite | `yarn test:server` |
| Browser e2e | `yarn e2e` |
| Replay CI locally | `yarn ci:local` |
 
## Deploying
 
Staging and production run on one VM from images CI has already published:
 
```bash
BIDDALOY_HOST=<vm address> scripts/deploy.sh staging <40-hex commit sha>
BIDDALOY_HOST=<vm address> scripts/deploy.sh prod <40-hex commit sha>   # only a sha that passed staging
```
 
Rollback, restore and secret rotation: [platform runbook](docs/architecture/28-platform-runbook.md).
 
