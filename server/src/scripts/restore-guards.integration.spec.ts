import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

/**
 * [98.5.05] The three "is this database empty?" guards of a prod restore run for real:
 * scripts/backup/restore.sh (count_sql, and the DO guard inside the restore transaction) and
 * deploy/bin/biddaloy-restore-prod (COUNT_SQL). Their SQL is pulled out of the scripts, so the
 * test fails if a copy drifts. Runs in a scratch database with only the tables the guards read.
 */
const root = join(__dirname, '..', '..', '..');
const restoreSh = readFileSync(join(root, 'scripts/backup/restore.sh'), 'utf8');
const restoreProd = readFileSync(join(root, 'deploy/bin/biddaloy-restore-prod'), 'utf8');

const take = (src: string, re: RegExp): string => {
  const m = re.exec(src);
  if (!m) throw new Error(`guard SQL not found: ${re}`);
  return m[1]!;
};
const COUNT_SH = take(restoreSh, /count_sql\(\) \{\n {2}cat <<'SQL'\n([\s\S]*?)\nSQL\n/);
const DO_GUARD = take(restoreSh, /(DO \$guard\$[\s\S]*?\$guard\$;)/);
const COUNT_PROD = take(restoreProd, /COUNT_SQL="([\s\S]*?)"\n/);

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const USER = '00000000-0000-4000-8000-0000000000b1';
const HOME = '00000000-0000-4000-8000-0000000000c1';
const REAL = '00000000-0000-4000-8000-0000000000d1';

describe('prod restore emptiness guards (real Postgres)', () => {
  let admin: Client;
  let db: Client;
  const name = `restore_guard_${process.pid}`;

  const reset = async (withIsPlatform = true) => {
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE platform_admins (user_id uuid PRIMARY KEY REFERENCES users(id));
      CREATE TABLE schools (id uuid PRIMARY KEY, slug text NOT NULL ${
        withIsPlatform ? ', is_platform boolean NOT NULL DEFAULT false' : ''
      });
      CREATE TABLE students (id serial PRIMARY KEY, tenant_id uuid NOT NULL);`);
  };
  const addOwner = () =>
    db.query(
      `INSERT INTO users VALUES ('${OWNER}'); INSERT INTO platform_admins VALUES ('${OWNER}')`,
    );
  const addHome = () =>
    db.query(`INSERT INTO schools (id, slug, is_platform) VALUES ('${HOME}', 'platform', true)`);
  const addDefault = () =>
    db.query(`INSERT INTO schools (id, slug) VALUES (gen_random_uuid(), 'default-school')`);

  /** Runs the three guards; true = the guard says "empty". */
  const verdicts = async () => {
    const sh = (await db.query(COUNT_SH)).rows[0]!;
    const prod = (await db.query(COUNT_PROD)).rows[0]!;
    const [prodSchools, prodUsers] = String(Object.values(prod)[0]).split('|').map(Number);
    let doGuard = true;
    try {
      await db.query(DO_GUARD);
    } catch (e) {
      expect((e as Error).message).toContain('restore-refused-not-empty');
      doGuard = false;
    }
    return {
      countSh: Number(Object.values(sh)[0]) === 0,
      countProd: prodSchools === 0 && prodUsers === 0,
      doGuard,
    };
  };
  const allEmpty = { countSh: true, countProd: true, doGuard: true };
  const allRefuse = { countSh: false, countProd: false, doGuard: false };

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    admin = new Client({ connectionString: url.toString() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`);
    await admin.query(`CREATE DATABASE ${name}`);
    url.pathname = `/${name}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
  });
  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });
  beforeEach(() => reset());

  it('(a) owners + is_platform home + default-school only is empty', async () => {
    await addOwner();
    await addHome();
    await addDefault();
    expect(await verdicts()).toEqual(allEmpty);
  });

  it('(b) a real school is refused', async () => {
    await addOwner();
    await addHome();
    await db.query(`INSERT INTO schools (id, slug) VALUES ('${REAL}', 'real-school')`);
    expect(await verdicts()).toEqual(allRefuse);
  });

  it('(c) a real non-owner user is refused', async () => {
    await addOwner();
    await addHome();
    await db.query(`INSERT INTO users VALUES ('${USER}')`);
    expect(await verdicts()).toEqual(allRefuse);
  });

  it('(d) with no is_platform column (older schema) any school except default-school counts', async () => {
    await reset(false);
    await addDefault();
    expect(await verdicts()).toEqual(allEmpty);
    await db.query(`INSERT INTO schools (id, slug) VALUES ('${HOME}', 'platform')`);
    expect(await verdicts()).toEqual(allRefuse);
  });

  it('(e) an is_platform home that holds students is refused', async () => {
    await addOwner();
    await addHome();
    await db.query(`INSERT INTO students (tenant_id) VALUES ('${HOME}')`);
    expect(await verdicts()).toEqual(allRefuse);
  });

  it('(g) an owner-only database with a populated default-school is refused', async () => {
    await addOwner();
    await addDefault();
    await db.query(
      `INSERT INTO students (tenant_id) SELECT id FROM schools WHERE slug = 'default-school'`,
    );
    expect(await verdicts()).toEqual(allRefuse);
  });

  it('(f) a missing table counts as 0 (empty database)', async () => {
    await db.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public`);
    expect(await verdicts()).toEqual(allEmpty);
  });
});
