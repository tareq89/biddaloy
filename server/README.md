# @beton-boi/server — NestJS Backend

NestJS REST API backend for the school fee management system. PostgreSQL via TypeORM, modular architecture.

## Quick Start

```bash
# From the monorepo root
yarn install
cp .env.example .env          # Then edit with your real credentials
yarn dev:server                # Auto-reload on changes
```

The server starts on **http://localhost:3000**. Health check: `GET /api/health`.

## Environment Variables

All env vars are defined in `.env` at the monorepo root. The server loads it via `ConfigModule`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `NODE_ENV` | No | `development` | `development` / `production` |
| `PORT` | No | `3000` | Server listen port |
| `JWT_SECRET` | Yes | — | Secret key for JWT tokens |
| `SEED_ADMIN_PASSWORD` | For seed | — | Password for the super admin account |
| `DB_SYNCHRONIZE` | No | `true` in dev | TypeORM auto-sync (dev only — never use in prod) |

## Commands

All commands run via `yarn workspace @beton-boi/server <command>` from the monorepo root.

### Build & Run

| Command | Description |
|---------|-------------|
| `build` | Compile TypeScript to `dist/` using `nest build` |
| `start` | Run compiled output (`node dist/main.js`) |
| `start:dev` | Watch mode with auto-reload (`nest start --watch`) |
| `start:prod` | Production start (same as `start`, use after `build`) |

### Lint & Test

| Command | Description |
|---------|-------------|
| `lint` | Type-check without emitting (`tsc --noEmit`) |
| `test` | Run tests in watch mode (`vitest`) |
| `test:run` | Run tests once (CI mode) |

### Database Migrations

| Command | Description |
|---------|-------------|
| `migration:generate <path>` | Generate a migration file from entity changes |
| `migration:run` | Apply all pending migrations |
| `migration:revert` | Roll back the last applied migration |
| `seed` | Create the initial SUPER_ADMIN user (admin@school.com) |
| `db:clear` | **Drop all tables** and custom ENUM types |
| `db:reset` | **One-shot: clear + recreate schema + seed admin** |

### Migration Workflow

```bash
# 1. After editing entities, generate the migration
yarn workspace @beton-boi/server migration:generate src/migrations/YourMigrationName

# 2. Apply it
yarn workspace @beton-boi/server migration:run

# 3. Seed the admin user (first time only)
yarn workspace @beton-boi/server seed

# 4. To start over from scratch
yarn workspace @beton-boi/server db:clear
yarn workspace @beton-boi/server migration:run
yarn workspace @beton-boi/server seed

# Or do it all in one shot (recommended)
yarn workspace @beton-boi/server db:reset
```

**Note:** `migration:generate <path>` requires a path argument — the migration name is the filename, e.g. `src/migrations/CreateUsersTable`.

## Project Structure

```
server/
├── src/
│   ├── main.ts                  # Entry point
│   ├── app.module.ts            # Root module (imports all feature modules)
│   ├── app.controller.ts        # Root health endpoint
│   ├── data-source.ts           # TypeORM CLI DataSource config (for migrations)
│   ├── config/
│   │   └── env.validation.ts    # Joi/Zod env validation
│   ├── common/
│   │   ├── filters/             # Exception filters
│   │   ├── pipes/               # Validation pipes
│   │   ├── guards/              # Auth guards (future)
│   │   └── decorators/          # Custom decorators (future)
│   ├── modules/
│   │   ├── users/               # User management
│   │   ├── students/            # Student & guardian records
│   │   ├── academics/           # Teachers, classes, academic years
│   │   ├── fees/                # Fee structures, student fees, payments
│   │   ├── invoices/            # Invoice generation
│   │   ├── communications/      # SMS/email reminders
│   │   ├── audit/               # Audit logging
│   │   └── health/              # Health check endpoint
│   ├── migrations/              # Generated migration files
│   └── scripts/
│       ├── seed.ts              # Super admin seeder
│       └── db-clear.ts          # Drop all tables
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

## Architecture Notes

- **API prefix**: all routes are under `/api/` (set via `app.setGlobalPrefix('api')`)
- **Validation**: `class-validator` + `ValidationPipe` globally
- **Error handling**: `AllExceptionsFilter` catches all unhandled errors
- **CORS**: enabled for `localhost:5173` in development only
- **Migrations**: stored in `src/migrations/` as TypeScript files, compiled to `dist/migrations/` on build
- **Data source**: `src/data-source.ts` is for the TypeORM CLI only; the app uses `TypeOrmModule.forRootAsync` in `app.module.ts`