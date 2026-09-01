/**
 * Test Environment Setup
 *
 * Loaded by vitest's setupFiles mechanism.
 *
 * TypeORM's `entities`/`migrations` glob options are loaded via its own
 * internal `require()`, not through vitest's module graph — so without a
 * transpile hook, requiring the raw `*.entity.ts`/migration `.ts` files
 * fails with `SyntaxError: Invalid or unexpected token` (Node can't parse
 * TypeScript directly). Registering ts-node here fixes that.
 *
 * `reflect-metadata` is loaded first because class-transformer's `@Type()`
 * decorator calls `Reflect.getMetadata` while a DTO module is being
 * evaluated — before any test body runs.
 */
import 'reflect-metadata';
import 'ts-node/register/transpile-only';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { buildResetSql, buildReferenceResetSql } from './reset-order';

// Must run at module top level, not deferred inside a beforeAll-only function:
// e2e specs import AppModule (which reads process.env via ConfigModule) at file
// top level too, and that import is evaluated during test *collection*, before
// any beforeAll runs. Loading .env.test here guarantees it's populated first.
process.env.NODE_ENV = 'test';
process.env.DB_SYNCHRONIZE = 'false';
// override: true — .env.test must win even if the shell already exports
// DATABASE_URL (e.g. pointing at the real dev DB per .env.example). Without
// this, dotenv's default "never overwrite an existing var" behavior means a
// dev-shaped DATABASE_URL in the ambient shell silently wins, and every test
// run fails assertTestDatabaseUrl() below with a confusing refusal.
config({ path: join(__dirname, '..', '.env.test'), override: true });

/** @type {import('typeorm').DataSource|null} */
let dataSource = null;

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

/**
 * Rebuild the schema from migrations if the previous spec file destroyed it.
 *
 * 13 of the 15 integration specs stand up their own TypeORM connection with
 * `{ synchronize: true, dropSchema: true }` (see `test/helpers/module.helper.ts`
 * and e.g. `src/modules/audit/audit.service.integration.spec.ts`). That drops
 * the entire `public` schema and rebuilds it from entity metadata, which
 * silently loses everything migrations create that entities don't describe:
 *
 * - `refresh_tokens` — `test/all-entities.ts` has no `RefreshToken`, so the
 *   table never comes back and every later e2e login dies with
 *   `relation "refresh_tokens" does not exist`;
 * - the `trg_audit_logs_write_only` trigger that makes `audit_logs`
 *   append-only (so `buildResetSql()`'s reason for TRUNCATE-ing that table
 *   would quietly stop applying);
 * - the `typeorm_migrations` bookkeeping table itself.
 *
 * That damage used to be invisible: every spec file's `afterAll` ran
 * `dropDatabase()` and the next file's `beforeAll` ran `runMigrations()`, so
 * each file rebuilt the schema from migrations regardless. `global-setup.ts`
 * now migrates once per *run*, so nothing repairs it in between — without
 * this check the first `dropSchema` spec poisons every file after it.
 *
 * `typeorm_migrations` is the probe: `dropSchema` always removes it and only
 * a real migration run recreates it, so its absence is exactly the signal
 * that someone rebuilt this schema from entity metadata. The healthy path
 * costs one `to_regclass` lookup; only a file that actually follows a
 * `dropSchema` spec pays the re-migrate.
 *
 * The real fix is dropping `synchronize`/`dropSchema` from those 13 specs so
 * the schema is never damaged at all. That is a bigger change than this
 * ticket, and is worth its own issue.
 */
async function repairSchemaIfDamaged(): Promise<void> {
  if (!dataSource) return;

  const rows = await dataSource.query(`SELECT to_regclass('public.typeorm_migrations') AS reg`);
  if (rows[0]?.reg != null) return;

  await dataSource.dropDatabase();
  await dataSource.runMigrations({ transaction: 'each' });
}

/**
 * Connect to the test database for this spec file, and reset the six
 * reference tables (schools/users/user_tenants/academic_years/classes/
 * class_sections) to the baseline seed row set.
 *
 * Migrations and the *first* baseline seed no longer run here — they run
 * once per test run in `test/global-setup.ts`, before any spec file's
 * `beforeAll` fires. But the reference tables still need a reset once per
 * spec *file* (not once per run): some spec files insert extra rows into
 * them directly (e.g. an extra `user_tenants` membership to test a second
 * role) or wipe and re-seed them for their own local fixtures, and used
 * to rely on the old per-file `dropDatabase()` to undo that before the
 * next file ran. See `buildReferenceResetSql()` in `./reset-order` for
 * the full explanation and the exact tables involved.
 *
 * This function only opens this file's own `DataSource` and does that one
 * file-level reset; `clearTransactionalTables` runs the cheaper per-test
 * reset through the same connection on every `beforeEach`.
 */
async function setupTestDatabase(): Promise<void> {
  const testDbUrl = process.env.DATABASE_URL;
  if (!testDbUrl) {
    throw new Error(
      'DATABASE_URL is not set. Create a .env.test file with test database credentials.\n' +
        'Example: DATABASE_URL=postgres://postgres:***@localhost:5432/biddaloy_test',
    );
  }
  assertTestDatabaseUrl(testDbUrl);

  dataSource = new DataSource({
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

  await dataSource.initialize();
  await repairSchemaIfDamaged();

  // Clear the 15 transactional tables first — a previous spec file's last
  // test can leave rows in them (e.g. enrollments pointing at a class
  // section) that would block deleting classes/schools below with a
  // foreign key violation.
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.query(buildResetSql());
    await queryRunner.query(buildReferenceResetSql());
  } finally {
    await queryRunner.release();
  }
}

/**
 * Clear transactional tables before each test.
 *
 * One multi-statement round trip (`buildResetSql()`, from
 * `./reset-order`) instead of 15 sequential `TRUNCATE` statements —
 * ~60x faster per test and implicitly transactional. See
 * `test/reset-order.ts` for the child-first table order and why
 * `audit_logs` alone still uses `TRUNCATE`. The reference tables
 * (`schools`, `users`, `user_tenants`, ...) are reset once per *file* in
 * `setupTestDatabase()` above, not here — see that function's comment.
 */
async function clearTransactionalTables(): Promise<void> {
  if (!dataSource) return;

  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();

  try {
    await queryRunner.query(buildResetSql());
  } finally {
    await queryRunner.release();
  }
}

// ─── Global Hooks ──────────────────────────────────────────────────

beforeAll(async () => {
  await setupTestDatabase();
}, 60000);

afterAll(async () => {
  if (dataSource && dataSource.isInitialized) {
    await dataSource.destroy();
  }
}, 30000);

beforeEach(async () => {
  await clearTransactionalTables();
}, 30000);

export { dataSource, clearTransactionalTables };
