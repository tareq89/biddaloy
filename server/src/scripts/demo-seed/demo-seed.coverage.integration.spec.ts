import 'ts-node/register/transpile-only';
import { createHash } from 'crypto';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../../../test/all-entities';
import type { DemoSlice } from './context';
import { validate } from './validator';

/**
 * [58.1.05] Demo-seed coverage guard. Seeds a fresh, migrated database and checks that every
 * entity is either filled by a slice, owed by a named ticket (`owedBy`) or exempt (`EXEMPT` in
 * slices.ts). Every message names the entity and the fix. Needs Postgres + Redis:
 * `yarn test-env run -- ...`.
 */
const BUDGET_MS = 90_000; // D39
const MAIN = { scale: 0.05, years: 2, anchor: '2026-10-10' };
const SMALL = { scale: 0.02, years: 1, anchor: '2026-10-10' };
const TENANTS = `SELECT id FROM schools WHERE slug LIKE 'bmsc-%'`;

const entityNames = ALL_ENTITIES.map((e) => (e as { name: string }).name);
const baseUrl = new URL(process.env.DATABASE_URL!);
const baseDb = baseUrl.pathname.slice(1);
const urlFor = (db: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${db}`;
  return u.toString();
};

async function admin<T>(fn: (ds: DataSource) => Promise<T>): Promise<T> {
  const ds = new DataSource({ type: 'postgres', url: urlFor('postgres') });
  await ds.initialize();
  try {
    return await fn(ds);
  } finally {
    await ds.destroy();
  }
}

const dropDb = (db: string) =>
  admin(async (a) => {
    await a.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [
      db,
    ]);
    await a.query(`DROP DATABASE IF EXISTS "${db}"`);
  });

async function freshMigratedDb(db: string): Promise<void> {
  await dropDb(db);
  await admin((a) => a.query(`CREATE DATABASE "${db}"`));
  const m = new DataSource({
    type: 'postgres',
    url: urlFor(db),
    migrations: [join(__dirname, '..', '..', 'migrations', '*.{ts,js}')],
    migrationsTableName: 'typeorm_migrations',
  });
  await m.initialize();
  // The initial migration calls uuid_generate_v4(); the Docker image creates the extension.
  await m.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  await m.runMigrations({ transaction: 'each' });
  await m.destroy();
}

interface Table {
  name: string;
  table: string;
  tenantScoped: boolean;
  cols: string[];
}

/** Only demo data counts: the migrated `default-school` row and any platform rows are not ours. */
const scope = (t: Table) =>
  t.table === 'schools'
    ? ` WHERE slug LIKE 'bmsc-%'`
    : t.tenantScoped
      ? ` WHERE tenant_id IN (${TENANTS})`
      : '';

/** Rows per entity (demo data only: bmsc-* tenants). */
async function countRows(ds: DataSource, tables: Table[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of tables) {
    const [{ n }] = await ds.query(`SELECT count(*)::int AS n FROM "${t.table}"${scope(t)}`);
    out[t.name] = Number(n);
  }
  return out;
}

/** Counts plus an md5 of business columns per table; ids, timestamps and hashes are left out. */
async function fingerprint(ds: DataSource, tables: Table[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of tables) {
    const cols = t.cols.filter(
      (c) => !/^(id|created_at|updated_at|deleted_at)$|_id$|hash|token|secret|salt/.test(c),
    );
    const row = cols.map((c) => `"${c}"::text`).join(', ') || `''`;
    const [{ h, n }] = await ds.query(
      `SELECT count(*)::int AS n,
              md5(COALESCE(string_agg(r, E'\\n' ORDER BY r), '')) AS h
         FROM (SELECT concat_ws('|', ${row}) AS r FROM "${t.table}"${scope(t)}) x`,
    );
    out[t.name] = `${n}:${h}`;
  }
  return out;
}

describe('demo seed coverage', () => {
  // biddaloy_demo* so runDemoSeed's own DB-name guard passes. A hash of the base name keeps runs
  // apart and the name under Postgres's 63-char limit (longer names truncate into one database).
  const tag = createHash('sha1').update(baseDb).digest('hex').slice(0, 12);
  const dbs = ['main', 'a', 'b'].map((x) => `biddaloy_demo_cov_${tag}_${x}`);
  const savedUrl = process.env.DATABASE_URL;
  let closeMain: () => Promise<void> = async () => {};
  let slices: DemoSlice[] = [];
  let exempt: Record<string, string> = {};
  let rows: Record<string, number> = {};
  let elapsed = 0;
  let violations: Awaited<ReturnType<typeof validate>> = [];
  let fpA: Record<string, string> = {};
  let fpB: Record<string, string> = {};

  /** Seeds `db` from a freshly loaded module graph (the app caches DATABASE_URL on first load). */
  async function seedInto(db: string, args: typeof MAIN, keepOpen: boolean) {
    await freshMigratedDb(db);
    process.env.DATABASE_URL = urlFor(db);
    vi.resetModules();
    const { runDemoSeed } = await import('./index');
    const slicesMod = await import('./slices');
    const t0 = Date.now();
    const run = await runDemoSeed(args, 'Demo@12345');
    const ms = Date.now() - t0;
    const tables: Table[] = ALL_ENTITIES.map((e) => {
      const meta = run.ds.entityMetadatas.find((m) => m.name === (e as { name: string }).name)!;
      return {
        name: meta.name,
        table: meta.tableName,
        tenantScoped: meta.columns.some((c) => c.databaseName === 'tenant_id'),
        cols: meta.columns.map((c) => c.databaseName),
      };
    });
    const exemptNames = Object.keys(slicesMod.EXEMPT);
    const result = {
      ds: run.ds,
      tables,
      slices: slicesMod.SLICES,
      exempt: slicesMod.EXEMPT,
      ms,
      fp: await fingerprint(
        run.ds,
        tables.filter((t) => !exemptNames.includes(t.name)),
      ),
      counts: keepOpen ? await countRows(run.ds, tables) : {},
      violations: keepOpen ? await validate(run.ds) : [],
    };
    if (keepOpen) closeMain = () => run.app.close();
    else await run.app.close();
    return result;
  }

  beforeAll(async () => {
    const main = await seedInto(dbs[0], MAIN, true);
    ({ slices, exempt, elapsed, violations } = {
      slices: main.slices,
      exempt: main.exempt,
      elapsed: main.ms,
      violations: main.violations,
    });
    rows = main.counts;
    fpA = (await seedInto(dbs[1], SMALL, false)).fp;
    fpB = (await seedInto(dbs[2], SMALL, false)).fp;
  }, 600_000);

  afterAll(async () => {
    await closeMain();
    process.env.DATABASE_URL = savedUrl;
    for (const db of dbs) await dropDb(db);
  }, 60_000);

  const fix = "Add it to a slice's covers or to EXEMPT (slices.ts) with a reason.";
  const coveredBy = (name: string) => slices.filter((s) => s.covers.some((c) => c.name === name));

  it('(a) every entity is in a slice covers or exempt', () => {
    const bad = entityNames.filter((n) => !coveredBy(n).length && !Object.hasOwn(exempt, n));
    expect(bad.map((n) => `${n} is in no slice's covers and not exempt. ${fix}`)).toEqual([]);
  });

  it('(b) no entity is covered by two slices', () => {
    const bad = entityNames.filter((n) => coveredBy(n).length > 1);
    expect(
      bad.map(
        (n) =>
          `${n} is covered by ${coveredBy(n)
            .map((s) => s.name)
            .join(' and ')}. Keep one.`,
      ),
    ).toEqual([]);
  });

  it('(c) a finished slice leaves no covered entity empty', () => {
    const bad = slices
      .filter((s) => !s.owedBy)
      .flatMap((s) => s.covers.filter((c) => rows[c.name] === 0).map((c) => ({ s, c })));
    expect(
      bad.map(
        ({ s, c }) =>
          `${c.name} has 0 rows but slice "${s.name}" has no owedBy. Seed it in slices/${s.name}.ts or set owedBy.`,
      ),
    ).toEqual([]);
  });

  it('(d) a slice that still has owedBy covers only empty entities', () => {
    const bad = slices
      .filter((s) => s.owedBy)
      .flatMap((s) => s.covers.filter((c) => rows[c.name] > 0).map((c) => ({ s, c })));
    expect(
      bad.map(
        ({ s, c }) =>
          `${c.name} already has rows but slice "${s.name}" still has owedBy "${s.owedBy}". Delete owedBy in slices/${s.name}.ts.`,
      ),
    ).toEqual([]);
  });

  it('(e) every exemption names a real, uncovered entity', () => {
    const bad = Object.keys(exempt).flatMap((n) => [
      ...(entityNames.includes(n) ? [] : [`EXEMPT has unknown entity ${n}. Remove it.`]),
      ...(coveredBy(n).length ? [`${n} is exempt but also in a covers. Remove one.`] : []),
    ]);
    const noReason = Object.entries(exempt)
      .filter(([, why]) => typeof why !== 'string' || !why.trim())
      .map(([n]) => `EXEMPT entry ${n} has no reason. Say why it is exempt.`);
    expect([...bad, ...noReason]).toEqual([]);
  });

  it('(f) the small run stays inside the 90 s budget', () => {
    expect(elapsed, 'seed run ms').toBeLessThan(BUDGET_MS);
  });

  it('same inputs give the same data', () => {
    expect(fpB).toEqual(fpA);
  });

  it('every invariant holds on the seeded data', () => {
    expect(violations).toEqual([]);
  });
});
