/**
 * [68.1.2220 / DATA-08] Migration safety net, on a throwaway database:
 *  1. running every migration gives the schema the entity files describe
 *     (no drift: `migration:generate` would write nothing), and
 *  2. every migration newer than ROUNDTRIP_FLOOR undoes and redoes cleanly.
 *
 * "Every @Entity file is in ALL_ENTITIES" is NOT checked here — that is
 * #2161 (`all-entities.completeness.spec.ts`). We use the entity glob, not
 * ALL_ENTITIES, so a forgotten list entry cannot hide drift.
 */
import 'reflect-metadata';
import 'ts-node/register/transpile-only';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl, withDbName } from './global-setup';

/**
 * Oldest migration the round-trip is NOT run below. `null` = undo everything.
 * Old migrations are never edited, so this only ever moves up. Each value
 * needs a reason and an owner.
 */
const ROUNDTRIP_FLOOR: { name: string; reason: string; owner: string } | null = {
  name: 'AddResultSmsCommunicationTrigger1789800012500',
  reason:
    'Its down() throws on an empty database: `default for column "trigger" cannot be cast ' +
    'automatically to type communication_logs_trigger_enum`. Old migrations are not edited.',
  owner: 'unowned (listed on #2150); fixing needs a new corrective migration, not an edit',
};

/** Drift statements we accept for now. Each needs a reason and an owner. */
const NAME_CHURN =
  'Hand-written migrations name constraints, indexes and enum types differently from ' +
  "TypeORM's hashed defaults, so the schema diff shows a rename as drop + create. Same " +
  'definition, different name; harmless at runtime.';
const NAME_CHURN_OWNER =
  'unowned (listed on #2150; follow-up: a name-insensitive FK/index comparison would let these go)';
const DRIFT_ALLOWED: { pattern: RegExp; reason: string; owner: string }[] = [
  { pattern: /^ALTER TABLE "\w+" DROP CONSTRAINT "/, reason: NAME_CHURN, owner: NAME_CHURN_OWNER },
  {
    pattern: /^ALTER TABLE "\w+" ADD CONSTRAINT "FK_\w+" FOREIGN KEY /,
    reason: NAME_CHURN,
    owner: NAME_CHURN_OWNER,
  },
  {
    pattern: /^ALTER TABLE "\w+" ADD CONSTRAINT "UQ_\w+" UNIQUE /,
    reason: NAME_CHURN + ' (unique constraint vs unique index)',
    owner: NAME_CHURN_OWNER,
  },
  { pattern: /^DROP INDEX "/, reason: NAME_CHURN, owner: NAME_CHURN_OWNER },
  { pattern: /^CREATE (UNIQUE )?INDEX "/, reason: NAME_CHURN, owner: NAME_CHURN_OWNER },
  {
    pattern:
      /^(DROP TYPE "public"\."\w+"|ALTER TYPE "public"\."\w+" RENAME TO "\w+"|CREATE TYPE "public"\."\w+_enum" AS ENUM\(.*\))$/,
    reason: NAME_CHURN + ' (enum types: *_old vs *_enum)',
    owner: NAME_CHURN_OWNER,
  },
  {
    pattern: /^ALTER TABLE "\w+" ALTER COLUMN "\w+" TYPE "public"\."\w+_enum"(\[\])? USING /,
    reason: NAME_CHURN + ' (column re-pointed to the identically-valued enum type)',
    owner: NAME_CHURN_OWNER,
  },
  {
    pattern: /^ALTER TABLE "\w+" ALTER COLUMN "\w+" (DROP DEFAULT|SET DEFAULT '[A-Z_]+')$/,
    reason: 'Brackets the enum re-pointing above (default dropped and re-set to the same literal).',
    owner: NAME_CHURN_OWNER,
  },
  // student_fees.year/month: generated columns (EXTRACT from period_start). The migration
  // created them natively, but TypeORM cannot read a generated column's expression back, so
  // it always wants to drop + re-add them, and re-add the four CHECKs that mention them.
  {
    pattern: /^ALTER TABLE "student_fees" (DROP COLUMN|ADD) "(year|month)"/,
    reason: 'TypeORM cannot introspect generated-column expressions (student_fees.year/month).',
    owner: 'unowned (listed on #2150)',
  },
  {
    pattern: /^(INSERT INTO|DELETE FROM) "typeorm_metadata"/,
    reason: 'Bookkeeping for the same student_fees generated columns.',
    owner: 'unowned (listed on #2150)',
  },
  {
    pattern: /^ALTER TABLE "student_fees" ADD CONSTRAINT "CHK_[0-9a-f]+" CHECK /,
    reason: 'student_fees CHECKs are named by hand in the migration; TypeORM re-adds them hashed.',
    owner: 'unowned (listed on #2150)',
  },
];

const migrationsGlob = join(__dirname, '..', 'src', 'migrations', '*.{ts,js}');
const entitiesGlob = join(__dirname, '..', 'src', '**', '*.entity.{ts,js}');

let admin: DataSource;
let ds: DataSource;
let guardDb: string;
let firstDrift: string[] = [];

async function terminateAndDrop(db: string): Promise<void> {
  await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [
    db,
  ]);
  await admin.query(`DROP DATABASE IF EXISTS "${db}"`);
}

/** The SQL `migration:generate` would write, minus allow-listed statements. */
async function rawDrift(): Promise<string[]> {
  const sql = await ds.driver.createSchemaBuilder().log();
  return sql.upQueries.map((q) => q.query);
}
function applyAllowList(queries: string[]): string[] {
  return queries.filter((q) => !DRIFT_ALLOWED.some((a) => a.pattern.test(q)));
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
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    if (admin?.isInitialized) {
      await terminateAndDrop(guardDb);
      await admin.destroy();
    }
  });

  it('migrations produce the schema the entities declare', async () => {
    await ds.runMigrations({ transaction: 'each' });
    firstDrift = await rawDrift();
    expect(applyAllowList(firstDrift)).toEqual([]);
  });

  it('every migration newer than the floor undoes and redoes cleanly', async () => {
    const floorName = ROUNDTRIP_FLOOR?.name;
    while ((await newestExecuted()) !== undefined && (await newestExecuted()) !== floorName) {
      await ds.undoLastMigration({ transaction: 'each' });
    }
    await ds.runMigrations({ transaction: 'each' });
    expect(applyAllowList(await rawDrift())).toEqual([]);
  });

  it('allow-list is not stale', () => {
    for (const a of DRIFT_ALLOWED) {
      expect(
        firstDrift.some((q) => a.pattern.test(q)),
        `${a.pattern} matched nothing: remove it, it was fixed`,
      ).toBe(true);
    }
  });
});
