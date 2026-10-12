/**
 * [68.1.2220 / DATA-08] Migration safety net, on a throwaway database:
 *  1. running every migration gives the schema the entity files describe,
 *     apart from the exact statements in `schema-drift-baseline.ts`, and
 *  2. every migration newer than ROUNDTRIP_FLOOR undoes and redoes cleanly.
 *
 * "Every @Entity file is in ALL_ENTITIES" is NOT checked here — that is
 * #2161 (`all-entities.completeness.spec.ts`). We use the entity glob, not
 * ALL_ENTITIES, so a forgotten list entry cannot hide drift.
 */
import 'reflect-metadata';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl, withDbName } from './global-setup';
import { DRIFT_BASELINE } from './schema-drift-baseline';

/**
 * Oldest migration the round-trip is NOT run below. `null` = undo everything.
 * Old migrations are never edited, so this only ever moves up.
 */
const ROUNDTRIP_FLOOR: { name: string; reason: string; owner: string } | null = {
  name: 'AddResultSmsCommunicationTrigger1789800012500',
  reason:
    'Its down() throws on an empty database: `default for column "trigger" cannot be cast ' +
    'automatically to type communication_logs_trigger_enum`. Old migrations are not edited.',
  owner: 'unowned, see #2342 (needs a new corrective migration, not an edit)',
};
/**
 * How many migrations sort below the floor (never round-tripped). A new
 * migration with an older timestamp than the floor would land here and its
 * down() would never run, so this number must not grow.
 */
const MIGRATIONS_BELOW_FLOOR = 49;

const BASELINE = DRIFT_BASELINE.flatMap((g) => g.statements);

const migrationsGlob = join(__dirname, '..', 'src', 'migrations', '*.{ts,js}');
const entitiesGlob = join(__dirname, '..', 'src', '**', '*.entity.{ts,js}');

let admin: DataSource;
let ds: DataSource;
let guardDb: string;
let firstDrift: string[];

async function terminateAndDrop(db: string): Promise<void> {
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [
    db,
  ]);
  await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
}

/** The SQL `migration:generate` would write right now. */
async function rawDrift(): Promise<string[]> {
  const sql = await ds.driver.createSchemaBuilder().log();
  return sql.upQueries.map((q) => q.query);
}

/** Multiset difference: each statement in `a` not matched by one in `b`. */
function minus(a: string[], b: string[]): string[] {
  const left = [...b];
  return a.filter((q) => {
    const i = left.indexOf(q);
    if (i === -1) return true;
    left.splice(i, 1);
    return false;
  });
}

async function newestExecuted(): Promise<string | undefined> {
  const rows: { name: string }[] = await ds.query(
    `SELECT name FROM typeorm_migrations ORDER BY id DESC LIMIT 1`,
  );
  return rows[0]?.name;
}

describe('migrations vs entities', { timeout: 300_000 }, () => {
  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    assertTestDatabaseUrl(url);
    const workerDb = url.split('/').pop()?.split('?')[0] ?? '';
    // A killed run leaves this DB behind: `test-env down` only drops
    // `<db>` and `<db>_w<N>`. The same worker's next run drops it first
    // (below), and `test-env sweep` usually catches it.
    guardDb = `${workerDb}_schema_guard`;

    admin = new DataSource({ type: 'postgres', url: withDbName(url, 'postgres') });
    await admin.initialize();
    await terminateAndDrop(guardDb);
    await admin.query(`CREATE DATABASE "${guardDb}"`);

    ds = new DataSource({
      type: 'postgres',
      url: withDbName(url, guardDb),
      entities: [entitiesGlob],
      migrations: [migrationsGlob],
      // Must match src/data-source.ts.
      migrationsTableName: 'typeorm_migrations',
      synchronize: false,
      logging: false,
    });
    await ds.initialize();
    await ds.runMigrations({ transaction: 'each' });
    firstDrift = await rawDrift();
    // Migrating a fresh DB takes ~5s alone and >10s (the default hook
    // timeout) under the full integration run's load.
  }, 300_000);

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin?.isInitialized) {
      await terminateAndDrop(guardDb);
      await admin.destroy();
    }
  }, 60_000);

  it('migrations produce the schema the entities declare', () => {
    // Any statement here is new drift: write a migration for it.
    expect(minus(firstDrift, BASELINE)).toEqual([]);
  });

  it('drift baseline is not stale', () => {
    // Any statement here is no longer produced: delete it from the baseline.
    expect(minus(BASELINE, firstDrift)).toEqual([]);
  });

  it('every migration newer than the floor undoes and redoes cleanly', async () => {
    const floorName = ROUNDTRIP_FLOOR?.name;
    if (floorName) {
      const names = (
        (await ds.query(`SELECT name FROM typeorm_migrations ORDER BY id`)) as { name: string }[]
      ).map((r) => r.name);
      expect(names, 'ROUNDTRIP_FLOOR.name is not a migration').toContain(floorName);
      expect(names.indexOf(floorName), 'a migration was added below ROUNDTRIP_FLOOR').toBe(
        MIGRATIONS_BELOW_FLOOR,
      );
    }
    let name: string | undefined;
    while ((name = await newestExecuted()) !== undefined && name !== floorName) {
      await ds.undoLastMigration({ transaction: 'each' });
    }
    await ds.runMigrations({ transaction: 'each' });
    // Exact, not via the baseline: redo must restore the very same schema.
    expect((await rawDrift()).sort()).toEqual([...firstDrift].sort());
  });
});
