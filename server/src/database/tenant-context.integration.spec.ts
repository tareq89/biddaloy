import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { ReportAreaFixture } from '@test/helpers/report-area.fixture';
import { TenantContext, installTenantHook } from './tenant-context';

/**
 * [#3949, Epic 59 D34] The tenant hook against the REAL walled tables, connecting AS `biddaloy_app`
 * (the role the migration creates). A superuser connection would prove nothing: it skips RLS.
 * Replaces the #3942 spike spec: its cases a-f live on here (a-e as-is on real tables, f split
 * into an owner case and a superuser case).
 *
 * Needs Postgres (`yarn test-env run -- ...`). The pool has 2 connections so they are reused.
 */
const TABLES = ['students', 'guardians', 'payments', 'invoices', 'student_fees'] as const;

describe('tenant context + app_tenant_wall (connected as biddaloy_app)', () => {
  let admin: DataSource; // the owner/superuser, as in dev and CI
  let app: DataSource; // biddaloy_app + hook
  let A: string;
  let B: string;
  const resetFailures: Error[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  const appUrl = () => {
    const u = new URL(process.env.DATABASE_URL!);
    u.username = 'biddaloy_app';
    u.password = 'app_pw_for_tests';
    return u.toString();
  };
  const count = async (t: string, target: Pick<DataSource, 'query'> = app) =>
    Number((await target.query(`SELECT count(*)::int AS n FROM ${t}`))[0].n);
  const tenantsSeen = async (t = 'students', target: Pick<DataSource, 'query'> = app) =>
    (await target.query(`SELECT DISTINCT tenant_id FROM ${t} ORDER BY 1`)).map(
      (r: { tenant_id: string }) => r.tenant_id,
    );
  const pid = async () => (await app.query('SELECT pg_backend_pid() AS pid'))[0].pid as number;
  const setting = async (target: Pick<DataSource, 'query'>) =>
    (await target.query(`SELECT current_setting('app.tenant_id', true) AS v`))[0].v as
      string | null;

  /** One school: `n` students, each with a guardian, a bill (student_fees), a payment and an invoice. */
  async function seedSchool(n: number): Promise<string> {
    const fx = new ReportAreaFixture(admin);
    const school = await fx.school();
    const year = await fx.year(school);
    const cls = await fx.klass(school, year, 'Six', 6);
    for (let i = 0; i < n; i++) {
      const s = await fx.student(school, year, cls);
      await fx.guardian(school, s, {
        name: 'G',
        phone: `0171${randomUUID().slice(0, 7)}`,
        primary: true,
      });
      await fx.bill(school, year, cls.classId, s, {
        total: 100,
        status: 'PENDING',
        dueDate: '2026-06-01',
      });
      await fx.payment(school, s, { amount: 50, method: 'CASH', at: '2026-05-02T00:00:00Z' });
      await admin.query(
        `INSERT INTO invoices (invoice_number, student_id, total_amount, issued_date, due_date, snapshot, tenant_id)
         VALUES ($1, $2, 10, '2026-05-01', '2026-06-01', '{}', $3)`,
        [`INV-${randomUUID()}`, s, school],
      );
    }
    return school;
  }

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL }).initialize();
    await admin.query(`ALTER ROLE biddaloy_app PASSWORD 'app_pw_for_tests'`);
    app = new DataSource({ type: 'postgres', url: appUrl(), extra: { max: 2 } });
    installTenantHook(app, (e) => resetFailures.push(e));
    await app.initialize();
  }, 120000);

  // The suite wipes transactional tables before every test, so seed per test.
  beforeEach(async () => {
    A = await seedSchool(2);
    B = await seedSchool(1);
  }, 60000);

  afterAll(async () => {
    await app?.destroy();
    for (const fn of cleanup) await fn().catch(() => undefined);
    await admin.destroy();
  });

  it('the connection really is the non-owner app role', async () => {
    const [r] = await app.query(
      `SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(r).toEqual({ u: 'biddaloy_app', rolsuper: false, rolbypassrls: false });
  });

  it('a. in tenant A, a query with no WHERE sees only A on all five tables', async () => {
    await TenantContext.run(async () => {
      for (const t of TABLES) {
        // The admin sees both schools; the app, inside A, sees A's share only.
        expect(await count(t), t).toBe(
          await count(
            `${t} WHERE ${t === 'student_fees' ? `student_id IN (SELECT id FROM students WHERE tenant_id = '${A}')` : `tenant_id = '${A}'`}`,
            admin,
          ),
        );
      }
      expect(await tenantsSeen('students')).toEqual([A]);
    }, A);
  });

  it('b. no tenant set: every school comes back (D22, the cockpit "school 360" read)', async () => {
    expect(await tenantsSeen('students')).toEqual([A, B].sort());
    expect(await count('student_fees')).toBe(await count('student_fees', admin));
  });

  it('c. no leak: the next context-free query on the same connection sees all rows, setting is exactly empty', async () => {
    const inA = await TenantContext.run(() => pid(), A);
    let reused = false;
    for (let i = 0; i < 6 && !reused; i++) {
      if ((await pid()) === inA) {
        reused = true;
        expect(await tenantsSeen('students')).toEqual([A, B].sort());
        // '' exactly (not null): the reset ran, it was not just never set.
        expect(await setting(app)).toBe('');
      }
    }
    expect(reused).toBe(true);
  });

  it("d. a transaction inside the context is walled, and WITH CHECK rejects another school's row", async () => {
    const seen = await TenantContext.run(
      () =>
        app.transaction(
          async (m) => (await m.query('SELECT tenant_id FROM students')) as unknown[],
        ),
      B,
    );
    expect(seen).toHaveLength(1);
    await expect(
      TenantContext.run(
        () =>
          app.query(
            `INSERT INTO guardians (full_name, relationship, phone, is_primary_contact, tenant_id) VALUES ('X','Father','01700000000',false,$1)`,
            [B],
          ),
        A,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('e. a job outside any request context is not walled, even while a request is in flight', async () => {
    let releaseRequest!: () => void;
    const hold = new Promise<void>((r) => (releaseRequest = r));
    const request = TenantContext.run(async () => {
      expect(await tenantsSeen()).toEqual([A]);
      await hold;
      expect(await tenantsSeen()).toEqual([A]);
    }, A);
    expect(TenantContext.current()).toBeUndefined();
    expect(await tenantsSeen()).toEqual([A, B].sort());
    releaseRequest();
    await request;
    expect(await tenantsSeen()).toEqual([A, B].sort());
  });

  it('f1. a superuser skips the wall (why D14 refuses it in production)', async () => {
    const runner = admin.createQueryRunner();
    try {
      await runner.query(`SELECT set_config('app.tenant_id', $1, false)`, [A]);
      expect(await runner.query('SELECT DISTINCT tenant_id FROM students')).toHaveLength(2);
      await runner.query(`SELECT set_config('app.tenant_id', '', false)`);
    } finally {
      await runner.release();
    }
  });

  it('f2. a plain table owner IS walled under FORCE, and skips the wall without it', async () => {
    const name = `walltest_${randomUUID().slice(0, 8)}`;
    const role = `${name}_owner`;
    cleanup.push(async () => {
      await admin.query(`DROP TABLE IF EXISTS ${name}`);
      await admin.query(`DROP ROLE IF EXISTS ${role}`);
    });
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD 'o_pw' NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`GRANT CREATE ON SCHEMA public TO ${role}`);
    const u = new URL(process.env.DATABASE_URL!);
    u.username = role;
    u.password = 'o_pw';
    const owner = await new DataSource({ type: 'postgres', url: u.toString() }).initialize();
    try {
      await owner.query(`CREATE TABLE ${name} (tenant_id uuid)`);
      await owner.query(`INSERT INTO ${name} VALUES ($1), ($2)`, [A, B]);
      await owner.query(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`);
      await owner.query(
        `CREATE POLICY w ON ${name} USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`,
      );
      const seeOwner = async () => {
        const q = owner.createQueryRunner();
        try {
          await q.query(`SELECT set_config('app.tenant_id', $1, false)`, [A]);
          return (await q.query(`SELECT count(*)::int AS n FROM ${name}`))[0].n as number;
        } finally {
          await q.query(`SELECT set_config('app.tenant_id', '', false)`);
          await q.release();
        }
      };
      expect(await seeOwner()).toBe(2); // ENABLE only: the owner skips the policy
      await owner.query(`ALTER TABLE ${name} FORCE ROW LEVEL SECURITY`);
      expect(await seeOwner()).toBe(1); // FORCE: the owner is walled too
      // ...and an owner can undo FORCE itself, which is why D14 also refuses the owner.
      await owner.query(`ALTER TABLE ${name} NO FORCE ROW LEVEL SECURITY`);
      expect(await seeOwner()).toBe(2);
    } finally {
      await owner.destroy();
    }
  });

  it('g. two requests (A and B) at once on a pool of 2 each see only their own school', async () => {
    let reached = 0;
    let open!: () => void;
    const both = new Promise<void>((r) => (open = r));
    const inside = (tenant: string) =>
      TenantContext.run(async () => {
        const first = await tenantsSeen();
        if (++reached === 2) open();
        await both; // deterministic hold: both requests are mid-flight before the second query
        return { first, second: await tenantsSeen() };
      }, tenant);
    const [ra, rb] = await Promise.all([inside(A), inside(B)]);
    expect(ra).toEqual({ first: [A], second: [A] });
    expect(rb).toEqual({ first: [B], second: [B] });
  });

  it('h. a rolled-back transaction does not leave the runner believing a stale tenant', async () => {
    const runner = app.createQueryRunner();
    try {
      await TenantContext.run(async () => {
        await runner.startTransaction();
        expect((await runner.query('SELECT DISTINCT tenant_id FROM students')).length).toBe(1);
        await runner.rollbackTransaction(); // undoes the set_config made inside the txn
        // Same runner, same context: must still be walled to A (not silently unwalled).
        expect(
          (await runner.query('SELECT DISTINCT tenant_id FROM students')).map(
            (r: any) => r.tenant_id,
          ),
        ).toEqual([A]);
      }, A);
      // Another context on the same runner: B, not A.
      const seen = await TenantContext.run(
        async () =>
          (await runner.query('SELECT DISTINCT tenant_id FROM students')).map(
            (r: any) => r.tenant_id,
          ),
        B,
      );
      expect(seen).toEqual([B]);
    } finally {
      await runner.release();
    }
    expect(await tenantsSeen()).toEqual([A, B].sort());
  });

  it('i. a failed reset destroys the connection, is reported, and is rethrown', async () => {
    const runner = app.createQueryRunner();
    await runner.connect();
    const dirtyPid = (await runner.query('SELECT pg_backend_pid() AS pid'))[0].pid as number;
    resetFailures.length = 0;
    await TenantContext.run(async () => {
      await runner.startTransaction();
      await expect(runner.query('SELECT 1/0')).rejects.toThrow(); // aborts the txn: the reset cannot run
    }, A);
    await expect(runner.release()).rejects.toThrow(/aborted/);
    expect(resetFailures).toHaveLength(1);
    // pg closed that backend instead of pooling it dirty.
    await vi.waitFor(async () => {
      const rows = await admin.query(`SELECT 1 FROM pg_stat_activity WHERE pid = $1`, [dirtyPid]);
      expect(rows).toHaveLength(0);
    });
    // The pool still works, and nothing dirty comes back.
    expect(await tenantsSeen()).toEqual([A, B].sort());
    expect(await setting(app)).toBe('');
  });

  it('the report runner still works under biddaloy_app (member of report_reader)', async () => {
    const q = app.createQueryRunner();
    try {
      await q.startTransaction();
      await q.query(`SELECT set_config('app.report_tenant', $1, true)`, [A]);
      await q.query('SET LOCAL ROLE report_reader');
      const rows = await q.query('SELECT DISTINCT tenant_id FROM students');
      expect(rows.map((r: any) => r.tenant_id)).toEqual([A]);
    } finally {
      await q.rollbackTransaction().catch(() => undefined);
      await q.release();
    }
  });
});
