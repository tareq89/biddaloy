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
 */
import 'reflect-metadata';
import 'ts-node/register/transpile-only';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { buildReferenceResetSql } from './reset-order';

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
}

export async function teardown(): Promise<void> {
  if (globalDataSource && globalDataSource.isInitialized) {
    await globalDataSource.dropDatabase();
    await globalDataSource.destroy();
  }
}
