import 'reflect-metadata';
import { MigrationExecutor, type DataSource } from 'typeorm';

/**
 * `node server/dist/scripts/migrate.js [run|pending|revert]` — runs TypeORM
 * migrations from the compiled image, no ts-node.
 *   run      (default) apply every pending migration, one transaction each
 *   pending  list pending migrations; exit 2 if any (deploy backs up first), else 0
 *   revert   undo the last applied migration
 * Exit codes: 0 ok, 2 pending, 1 error. Output names migrations only, never
 * DATABASE_URL.
 */
export type MigrateMode = 'run' | 'pending' | 'revert';

// TypeORM's own executor: timestamp-ordered, schema-aware, no hand-built SQL.
async function appliedNames(ds: DataSource): Promise<Set<string>> {
  const rows = await new MigrationExecutor(ds).getExecutedMigrations();
  return new Set(rows.map((r) => r.name));
}

/** Runs one mode against an already-initialized DataSource; returns the exit code. */
export async function runMigrate(
  ds: DataSource,
  mode: MigrateMode,
  log: (line: string) => void = console.log,
): Promise<number> {
  if (mode === 'pending') {
    const names = (await new MigrationExecutor(ds).getPendingMigrations()).map((m) => m.name);
    log(names.length ? `${names.length} pending:\n${names.join('\n')}` : 'no pending migrations');
    return names.length ? 2 : 0;
  }
  if (mode === 'revert') {
    const before = await appliedNames(ds);
    await ds.undoLastMigration({ transaction: 'each' });
    const after = await appliedNames(ds);
    log(`reverted: ${[...before].filter((n) => !after.has(n)).join(', ') || 'nothing'}`);
    return 0;
  }
  const applied = await ds.runMigrations({ transaction: 'each' });
  applied.forEach((m) => log(`applied ${m.name}`));
  log(`${applied.length} migration(s) applied`);
  return 0;
}

if (require.main === module) {
  void (async () => {
    const mode = (process.argv[2] ?? 'run') as MigrateMode;
    if (!['run', 'pending', 'revert'].includes(mode)) {
      console.error(`unknown mode "${mode}" (use run | pending | revert)`);
      process.exit(1);
    }
    // Lazy: importing data-source loads .env and builds the connection options.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ds: DataSource = require('../data-source').default;
    let code = 1;
    try {
      await ds.initialize();
      code = await runMigrate(ds, mode);
    } catch (err) {
      console.error(`migrate ${mode} failed:`, err instanceof Error ? err.message : String(err));
    } finally {
      if (ds.isInitialized) await ds.destroy();
    }
    process.exit(code);
  })();
}
