# Deployment

> Full step-by-step deploy/renewal instructions live in the root
> [`README.md`](../../README.md#docker-deployment) — this doc is just the
> shape of it, for orientation.

## Docker Compose topology

```mermaid
flowchart LR
    Internet -->|HTTPS| nginx
    nginx -->|reverse proxy| app["app\n(NestJS: API + the built SPA at /)"]
    app --> db[("db\nPostgreSQL")]
    app --> redis[("redis")]
    certbootstrap["cert-bootstrap"] -.->|"issues/renews\nLet's Encrypt cert"| nginx
```

Services (`docker-compose.yml`): `app`, `db` (Postgres), `redis`, `nginx`,
`cert-bootstrap` (automated Let's Encrypt issuance — nginx self-reloads
every 6h to pick up renewed certs, see `nginx/reload-loop.sh`).

This whole stack — including automated TLS — was **not** in the original
plan, which treated Docker as a future migration. It shipped as the actual
deployment mechanism.

## Build pipeline

`yarn build:all` (`scripts/build-all.sh`) builds `shared` → `ui` →
`client-admin` → `server`, and assembles a single deployable
`build-output/` folder that can be zipped and shipped to a VPS without
Docker too — see the README's "Production Build" / "Deploy to VPS"
sections for that path.

## How a request is served

```mermaid
flowchart LR
    REQ["GET /students/42"] --> NGINX["nginx"]
    NGINX --> APP["NestJS"]
    APP --> STATIC{"file exists in\nclient-admin/dist?"}
    STATIC -->|yes| FILE["that file\n(/assets/* → 1-year immutable cache)"]
    STATIC -->|"no, and GET/HEAD\noutside /api"| INDEX["index.html\n(the SPA router takes over)"]
    STATIC -->|"no, and POST\nor under /api"| NOTFOUND["404"]
```

One SPA at `/` since [8.9.10] — no `/admin/` or `/student/` prefix, and no
root redirect. The rules above live in `server/src/spa-fallback.ts`
(unit-tested there); nginx's long-cache rule matches `^/assets/`
accordingly. Two behaviours this fixed: `GET /teacher/*` used to return
**500** (the directory never existed, so `sendFile` hit ENOENT with no
error callback) and `POST /admin/anything` used to return **200 + HTML**.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs, per the root README's
"CI" section: build, lint, unit tests, an integration/e2e job against a
real Postgres, a dependency audit, and a non-blocking dead-code check
(`knip`). See `ui/CONTRIBUTING.md` for the PR checklist tied to these gates.
