/**
 * Vitest globalSetup — runs once per `vitest run` invocation, in its own
 * process, before any spec file's worker starts.
 *
 * Migrations and baseline seed data used to run in `test/setup.ts`'s
 * `beforeAll`, once per spec file (39 files ⇒ 39 migrate-and-seed cycles).
 * They now run exactly once here.
 *
 * `test/setup.ts` still runs per file: it opens its own `DataSource`, resets
 * the reference tables to the baseline row set, and clears the transactional
 * tables between tests. It re-migrates only in the one case where it has to
 * — when a spec file using `dropSchema: true` rebuilt the schema from entity
 * metadata and destroyed the migration-only objects. See
 * `repairSchemaIfDamaged()` there.
 *
 * TypeORM's `entities`/`migrations` glob options are loaded via its own
 * internal `require()`, not through vitest's module graph, so — same as
 * `test/setup.ts` — this file needs its own transpile hook to require the
 * raw `.entity.ts`/migration `.ts` files.
 *
 * [18.2.1] After migrating/seeding `biddaloy_test` (the "template"), this
 * also clones it into `WORKERS` worker-local databases — `biddaloy_test_w1`
 * … `biddaloy_test_wN` — via `CREATE DATABASE … TEMPLATE`. That clone copies
 * the already-migrated-and-seeded schema+data in one filesystem-level copy,
 * far cheaper than each worker re-running every migration. Each vitest pool
 * worker then points its own `DATABASE_URL` at its own worker database (see
 * `test/setup.ts`), so `fileParallelism: false` in `vitest.config.ts` is no
 * longer needed to avoid workers racing each other's DELETEs on one shared
 * database — see D19.
 */
import 'reflect-metadata';
import 'ts-node/register/transpile-only';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { buildReferenceResetSql } from './reset-order';

/** [18.2.1/D19] Number of parallel vitest pool workers, and worker databases. */
export const WORKERS = 4;

/** Shared with test/setup.ts and test/reset-order.integration.spec.ts so the naming convention lives in one place. */
export function workerDbName(baseDbName: string, worker: number | string): string {
  return `${baseDbName}_w${worker}`;
}

function withDbName(url: string, dbName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

/**
 * Refuses to run destructive setup/teardown against a database that doesn't
 * look like a dedicated test database, so a misconfigured DATABASE_URL can
 * never wipe real dev/prod data.
 */
function assertTestDatabaseUrl(url: string): void {
  const dbName = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/test/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests against database "${dbName}" — its name doesn't ` +
        'contain "test". Point DATABASE_URL in server/.env.test at a dedicated ' +
        'test database (e.g. biddaloy_test) to avoid wiping real data.',
    );
  }
}

let globalDataSource: DataSource | null = null;
/** Base name of the template database, e.g. "biddaloy_test". Set in `setup()`. */
let templateDbName: string | null = null;
/** The template's DATABASE_URL, with the db name swapped per call. Set in `setup()`. */
let templateDbUrl: string | null = null;

/**
 * Opens a short-lived admin connection to Postgres's `postgres` maintenance
 * database — `CREATE DATABASE`/`DROP DATABASE` can't run against the very
 * database they're creating/dropping, and `CREATE DATABASE … TEMPLATE`
 * additionally requires no other session connected to the template.
 */
async function withAdminConnection<T>(fn: (admin: DataSource) => Promise<T>): Promise<T> {
  if (!templateDbUrl) throw new Error('withAdminConnection called before setup()');
  const admin = new DataSource({
    type: 'postgres',
    url: withDbName(templateDbUrl, 'postgres'),
    synchronize: false,
    logging: false,
  });
  await admin.initialize();
  try {
    return await fn(admin);
  } finally {
    await admin.destroy();
  }
}

async function terminateAndDrop(admin: DataSource, dbName: string): Promise<void> {
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`,
    [dbName],
  );
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}"`);
}

/**
 * Clones the migrated-and-seeded template database into `biddaloy_test_w1`
 * … `biddaloy_test_w{WORKERS}` via `CREATE DATABASE … TEMPLATE`, one worker
 * database per vitest pool worker. See the file-header comment and D19.
 */
async function cloneWorkerDatabases(): Promise<void> {
  if (!templateDbName) throw new Error('cloneWorkerDatabases called before setup()');
  const baseName = templateDbName;

  await withAdminConnection(async (admin) => {
    // Nothing may be connected to the template while it's used as a
    // `CREATE DATABASE … TEMPLATE` source — including globalDataSource's own
    // connection, which is why setup() destroys it before calling this.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [baseName],
    );

    for (let worker = 1; worker <= WORKERS; worker++) {
      const dbName = workerDbName(baseName, worker);
      await terminateAndDrop(admin, dbName);
      await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE "${baseName}"`);
    }
  });
}

async function dropWorkerDatabases(): Promise<void> {
  if (!templateDbName) return;
  const baseName = templateDbName;

  await withAdminConnection(async (admin) => {
    for (let worker = 1; worker <= WORKERS; worker++) {
      await terminateAndDrop(admin, workerDbName(baseName, worker));
    }
  });
}

export async function setup(): Promise<void> {
  // .env.test must win even if the shell already exports DATABASE_URL
  // (e.g. pointing at the real dev DB per .env.example).
  config({ path: join(__dirname, '..', '.env.test'), override: true });
  process.env.NODE_ENV = 'test';
  process.env.DB_SYNCHRONIZE = 'false';

  const testDbUrl = process.env.DATABASE_URL;
  if (!testDbUrl) {
    throw new Error(
      'DATABASE_URL is not set. Create a .env.test file with test database credentials.\n' +
        'Example: DATABASE_URL=postgres://postgres:***@localhost:5432/biddaloy_test',
    );
  }
  assertTestDatabaseUrl(testDbUrl);
  templateDbUrl = testDbUrl;
  templateDbName = testDbUrl.split('/').pop()?.split('?')[0] ?? '';

  globalDataSource = new DataSource({
    type: 'postgres',
    url: testDbUrl,
    entities: [join(__dirname, '..', 'src', '**', '*.entity.{ts,js}')],
    migrations: [join(__dirname, '..', 'src', 'migrations', '*.{ts,js}')],
    // Must match src/data-source.ts's migrationsTableName — otherwise this
    // DataSource can't see which migrations already ran and re-applies them.
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    logging: false,
  });

  await globalDataSource.initialize();

  // Drop first so a run always starts from a known schema, even if a
  // previous run died mid-way (e.g. a killed CI job) and left the test
  // database in a half-migrated state.
  await globalDataSource.dropDatabase();
  await globalDataSource.runMigrations({ transaction: 'each' });
  // Same statement every spec file's `beforeAll` uses, so there is exactly
  // one definition of "the baseline row set" — two copies would drift and
  // make the baseline depend on a file's position in the run.
  await globalDataSource.query(buildReferenceResetSql());

  // Close before cloning — CREATE DATABASE … TEMPLATE refuses to run while
  // any session (including this one) is connected to the template.
  await globalDataSource.destroy();
  globalDataSource = null;

  await cloneWorkerDatabases();
}

export async function teardown(): Promise<void> {
  // globalDataSource was already destroyed at the end of setup() (before
  // cloning); nothing left to drop/destroy on it here. dropDatabase() on
  // postgres only truncates the `public` schema, not the database itself —
  // the template (`biddaloy_test`) must keep existing so the next run's
  // setup() can connect to it.
  await dropWorkerDatabases();
}
