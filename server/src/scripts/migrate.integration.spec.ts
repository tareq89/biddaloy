import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { resolve } from 'path';
import { runMigrate } from './migrate';

/** Fresh scratch database on the worker's server, so the migrations run from zero. */
describe('migrate script (integration)', () => {
  const scratch = `migrate_spec_${process.pid}`;
  const baseUrl = new URL(process.env.DATABASE_URL as string);
  const admin = new DataSource({ type: 'postgres', url: baseUrl.toString() });
  let ds: DataSource;
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);

  beforeAll(async () => {
    await admin.initialize();
    await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
    await admin.query(`CREATE DATABASE "${scratch}"`);
    const url = new URL(baseUrl);
    url.pathname = `/${scratch}`;
    ds = new DataSource({
      type: 'postgres',
      url: url.toString(),
      migrations: [resolve(__dirname, '..', 'migrations', '*.{ts,js}')],
      migrationsTableName: 'typeorm_migrations',
    });
    await ds.initialize();
    // The initial migration calls uuid_generate_v4(); the Docker image creates the extension.
    await ds.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  }, 60000);

  afterAll(async () => {
    await ds?.destroy();
    await admin.query(`DROP DATABASE IF EXISTS "${scratch}"`);
    await admin.destroy();
  });

  it('pending on a fresh DB exits 2 and lists every migration', async () => {
    expect(await runMigrate(ds, 'pending', log)).toBe(2);
    expect(lines[0]).toMatch(new RegExp(`^${ds.migrations.length} pending:`));
    expect(lines[0].split('\n')).toHaveLength(ds.migrations.length + 1);
  });

  it('run applies all, then pending exits 0', async () => {
    expect(await runMigrate(ds, 'run', log)).toBe(0);
    expect(await runMigrate(ds, 'pending', log)).toBe(0);
  }, 300000);

  it('revert undoes exactly one migration', async () => {
    lines.length = 0;
    expect(await runMigrate(ds, 'revert', log)).toBe(0);
    expect(lines[0]).toMatch(/^reverted: \S+$/);
    expect(await runMigrate(ds, 'pending', log)).toBe(2);
  }, 120000);
});
