import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { AppRoleTenantRls1792500000100 } from '../src/migrations/1792500000100-AppRoleTenantRls';

/**
 * [#3949] Up / down / up of the app-role migration on a migrated database (the worker's own
 * copy, restored to "up" at the end), plus the default-privileges promise: a table a LATER
 * migration creates is reachable by `biddaloy_app` without another grant.
 */
describe('AppRoleTenantRls migration', () => {
  let admin: DataSource;
  const migration = new AppRoleTenantRls1792500000100();
  const WALLED = ['students', 'guardians', 'payments', 'invoices', 'student_fees'];

  const run = async (dir: 'up' | 'down') => {
    const q = admin.createQueryRunner();
    try {
      await migration[dir](q);
    } finally {
      await q.release();
    }
  };
  const policies = async () =>
    (await admin.query(
      `SELECT c.relname, c.relforcerowsecurity AS forced
           FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
          WHERE p.polname = 'app_tenant_wall' ORDER BY 1`,
    )) as Array<{ relname: string; forced: boolean }>;
  const can = async (table: string, priv: string) =>
    (
      await admin.query(`SELECT has_table_privilege('biddaloy_app', $1, $2) AS ok`, [table, priv])
    )[0].ok as boolean;

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL }).initialize();
  });
  afterAll(async () => {
    await admin.destroy();
  });

  it('is applied: a non-privileged login role, five walled tables, all forced', async () => {
    const [role] = await admin.query(
      `SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'biddaloy_app'`,
    );
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
    expect(role.rolcanlogin).toBe(true);
    expect((await policies()).map((p) => p.relname).sort()).toEqual([...WALLED].sort());
    expect((await policies()).every((p) => p.forced)).toBe(true);
  });

  it('up, down, up leaves the same state, and down never drops the role', async () => {
    try {
      await run('down');
      expect(await policies()).toEqual([]);
      expect(await can('students', 'SELECT')).toBe(false);
      expect(
        (await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = 'biddaloy_app'`)).length,
      ).toBe(1);
    } finally {
      await run('up'); // never leave the worker database without the wall
    }
    expect((await policies()).map((p) => p.relname).sort()).toEqual([...WALLED].sort());
    expect(await can('students', 'DELETE')).toBe(true);
    await run('up'); // idempotent: a second up (role/policies exist) must not throw
  });

  it('a table a later migration creates is reachable through default privileges', async () => {
    const name = `later_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    await admin.query(`CREATE TABLE ${name} (id serial PRIMARY KEY, v text)`);
    try {
      expect(await can(name, 'SELECT')).toBe(true);
      expect(await can(name, 'INSERT')).toBe(true);
      const [{ ok }] = await admin.query(
        `SELECT has_sequence_privilege('biddaloy_app', '${name}_id_seq', 'USAGE') AS ok`,
      );
      expect(ok).toBe(true);
    } finally {
      await admin.query(`DROP TABLE ${name}`);
    }
  });

  it('keeps the report_reader policies and membership', async () => {
    const [{ n }] = await admin.query(
      `SELECT count(*)::int AS n FROM pg_policy WHERE polname = 'report_tenant'`,
    );
    expect(n).toBeGreaterThan(0);
    const [{ member }] = await admin.query(
      `SELECT pg_has_role('biddaloy_app', 'report_reader', 'MEMBER') AS member`,
    );
    expect(member).toBe(true);
  });
});
