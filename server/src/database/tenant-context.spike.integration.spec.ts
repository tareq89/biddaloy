import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AsyncLocalStorage } from 'async_hooks';
import { DataSource, QueryRunner } from 'typeorm';

/**
 * [#3942, Epic 59.0 D12/D13] Spike: can a request's tenant reach Postgres on pooled connections
 * through AsyncLocalStorage + a query-runner hook, without ever leaking to the next user of the
 * connection? The hook lives in this spec only; 59.2.04 promotes it (or, if this fails, shrinks to a doc).
 *
 * Needs Postgres (`yarn test-env run -- ...`). Throwaway objects: role `spike_app`, table `spike_rows`.
 */
const als = new AsyncLocalStorage<{ tenantId?: string }>();
const SETTING = 'app.tenant_id';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** Installs the hook on a DataSource: set before a query when the connection's value differs, reset on release. */
function installTenantHook(ds: DataSource): void {
  const create = ds.createQueryRunner.bind(ds);
  ds.createQueryRunner = (...args: Parameters<DataSource['createQueryRunner']>): QueryRunner => {
    const runner = create(...args);
    const query = runner.query.bind(runner);
    const release = runner.release.bind(runner);
    let remembered = ''; // every connection is '' when handed out (reset on release)
    const sync = async () => {
      const want = als.getStore()?.tenantId ?? '';
      if (want !== remembered) {
        await query('SELECT set_config($1, $2, false)', [SETTING, want]);
        remembered = want;
      }
    };
    runner.query = (async (sql: string, params?: unknown[], ...rest: unknown[]) => {
      await sync();
      return (query as any)(sql, params, ...rest);
    }) as QueryRunner['query'];
    runner.release = async () => {
      if (remembered !== '') await query('SELECT set_config($1, $2, false)', [SETTING, '']);
      return release();
    };
    return runner;
  };
}

describe('tenant context spike (RLS on pooled connections)', () => {
  let admin: DataSource; // the connecting superuser/owner, as in dev and CI
  let app: DataSource; // spike_app, pool of 2 so connections are reused
  const spikeUrl = () => {
    const u = new URL(process.env.DATABASE_URL!);
    u.username = 'spike_app';
    u.password = 'spike_pw';
    return u.toString();
  };
  const tenantsSeen = async (target: Pick<DataSource, 'query'>) =>
    (await target.query('SELECT DISTINCT tenant_id FROM spike_rows ORDER BY 1')).map(
      (r: { tenant_id: string }) => r.tenant_id,
    );
  const pid = async (target: Pick<DataSource, 'query'>) =>
    (await target.query('SELECT pg_backend_pid() AS pid'))[0].pid as number;

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url: process.env.DATABASE_URL }).initialize();
    await admin.query(`DROP TABLE IF EXISTS spike_rows`);
    await admin.query(
      `DO $$ BEGIN DROP OWNED BY spike_app; EXCEPTION WHEN undefined_object THEN NULL; END $$`,
    );
    await admin.query(`DROP ROLE IF EXISTS spike_app`);
    await admin.query(
      `CREATE ROLE spike_app LOGIN PASSWORD 'spike_pw' NOSUPERUSER NOBYPASSRLS NOINHERIT`,
    );
    await admin.query(`CREATE TABLE spike_rows (tenant_id uuid, v text)`);
    await admin.query(`GRANT SELECT, INSERT ON spike_rows TO spike_app`);
    await admin.query(`ALTER TABLE spike_rows ENABLE ROW LEVEL SECURITY`);
    await admin.query(`ALTER TABLE spike_rows FORCE ROW LEVEL SECURITY`);
    // D12 + D22: a set tenant walls the rows; an unset (or reset '') one passes everything.
    await admin.query(`CREATE POLICY tenant_wall ON spike_rows TO spike_app
      USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL
             OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL
             OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`);
    await admin.query(`INSERT INTO spike_rows VALUES ($1,'a1'),($1,'a2'),($2,'b1')`, [A, B]);

    app = new DataSource({ type: 'postgres', url: spikeUrl(), extra: { max: 2 } });
    installTenantHook(app);
    await app.initialize();
  }, 60000);

  afterAll(async () => {
    await app?.destroy();
    await admin.query(`DROP TABLE IF EXISTS spike_rows`);
    await admin.query(`DROP OWNED BY spike_app`);
    await admin.query(`DROP ROLE IF EXISTS spike_app`);
    await admin.destroy();
  });

  it('a. inside tenant A, a query with no WHERE returns only A rows', async () => {
    expect(await als.run({ tenantId: A }, () => tenantsSeen(app))).toEqual([A]);
  });

  it('b. with no context, all rows come back (D22)', async () => {
    expect(await tenantsSeen(app)).toEqual([A, B]);
  });

  it('c. no leak: the next context-free query on the same physical connection sees all rows', async () => {
    const inA = await als.run({ tenantId: A }, () => pid(app));
    let reused = false;
    for (let i = 0; i < 6 && !reused; i++) {
      if ((await pid(app)) === inA) {
        reused = true;
        expect(await tenantsSeen(app)).toEqual([A, B]);
        expect(await pid(app)).toBe(inA);
      }
    }
    expect(reused).toBe(true);
    // The raw connection state itself is clean, not just the policy outcome.
    const raw = await app.query(`SELECT current_setting('app.tenant_id', true) AS v`);
    expect(raw[0].v === '' || raw[0].v === null).toBe(true);
  });

  it('d. a transaction inside the context is walled, and the wall also guards writes', async () => {
    const seen = await als.run({ tenantId: B }, () =>
      app.transaction(
        async (m) => (await m.query('SELECT tenant_id FROM spike_rows')) as unknown[],
      ),
    );
    expect(seen).toHaveLength(1);
    expect(await tenantsSeen(app)).toEqual([A, B]);
    await expect(
      als.run({ tenantId: A }, () => app.query(`INSERT INTO spike_rows VALUES ($1, 'x')`, [B])),
    ).rejects.toThrow(/row-level security/);
  });

  it('e. a job outside any request context is not walled, even while a request is in flight', async () => {
    let releaseRequest!: () => void;
    const hold = new Promise<void>((r) => (releaseRequest = r));
    const request = als.run({ tenantId: A }, async () => {
      expect(await tenantsSeen(app)).toEqual([A]);
      await hold;
      expect(await tenantsSeen(app)).toEqual([A]);
    });
    const job = async () => tenantsSeen(app); // BullMQ-style: plain async function, no ALS store
    expect(als.getStore()).toBeUndefined();
    expect(await job()).toEqual([A, B]);
    releaseRequest();
    await request;
    expect(await job()).toEqual([A, B]);
  });

  it('f. as the superuser/owner the wall does not apply (why D14 needs a boot check)', async () => {
    const runner = admin.createQueryRunner();
    try {
      await runner.query(`SELECT set_config('app.tenant_id', $1, false)`, [A]);
      const rows = await runner.query('SELECT DISTINCT tenant_id FROM spike_rows');
      expect(rows).toHaveLength(2);
      await runner.query(`SELECT set_config('app.tenant_id', '', false)`);
    } finally {
      await runner.release();
    }
  });
});
