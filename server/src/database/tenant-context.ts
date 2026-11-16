import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import type { DataSource, QueryRunner } from 'typeorm';

/**
 * [#3949, Epic 59 D12/D13/D22] The request's school, carried to Postgres so row-level security
 * (policy `app_tenant_wall`) can wall five tables even for SQL that forgot its `tenant_id`.
 *
 *   middleware: run({}) --> ContextGuard: setTenant(id) --> hook: set_config before a query
 *
 * - A middleware opens an empty store per request; the guard fills it once the school is resolved
 *   (a guard cannot wrap the handler, so it mutates the store, like `RequestActorContext`).
 * - Platform routes and queue jobs never set it: no tenant in the store means no wall (D22).
 * - Never `enterWith`: that would leak a school into whatever runs next on the same async chain.
 */
export const TENANT_SETTING = 'app.tenant_id';

interface TenantStore {
  tenantId?: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
  run<T>(fn: () => T, tenantId?: string): T {
    return storage.run({ tenantId }, fn);
  },
  /** No store (queue worker, script): nothing to wall, so nothing is set. */
  setTenant(tenantId: string): void {
    const store = storage.getStore();
    if (store) store.tenantId = tenantId;
  },
  current(): string | undefined {
    return storage.getStore()?.tenantId;
  },
};

export function tenantContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  TenantContext.run(next);
}

/**
 * Installs the hook on a DataSource: before a query, set `app.tenant_id` on the connection when
 * its value differs from the one wanted; on release, reset it to '' so the pool never hands a
 * dirty connection to the next user.
 *
 * Limits (also in 02-auth-and-multitenancy.md):
 * - `remembered` is inferred per runner. A rollback can undo a `set_config(..., false)` made
 *   inside the transaction, so after one it is forgotten and re-set on the next query.
 * - `runner.stream()` does not go through `query` and is not walled by this hook.
 * - A failed reset never returns the connection to the pool: `releasePostgresConnection(err)`
 *   makes pg destroy it, and the error is logged and rethrown.
 */
export function installTenantHook(ds: DataSource, onResetFailure?: (e: Error) => void): void {
  const create = ds.createQueryRunner.bind(ds);
  ds.createQueryRunner = (...args: Parameters<DataSource['createQueryRunner']>): QueryRunner => {
    const runner = create(...args);
    const query = runner.query.bind(runner);
    const release = runner.release.bind(runner);
    const rollback = runner.rollbackTransaction.bind(runner);
    let remembered = ''; // every connection is '' when handed out (reset on release)
    const sync = async () => {
      const want = TenantContext.current() ?? '';
      if (want !== remembered) {
        await query('SELECT set_config($1, $2, false)', [TENANT_SETTING, want]);
        remembered = want;
      }
    };
    runner.query = (async (sql: string, params?: unknown[], ...rest: unknown[]) => {
      await sync();
      return (query as any)(sql, params, ...rest);
    }) as QueryRunner['query'];
    runner.rollbackTransaction = async () => {
      try {
        return await rollback();
      } finally {
        remembered = '?'; // unknown now: forces a re-set on the next query and a reset on release
      }
    };
    runner.release = async () => {
      if (remembered !== '') {
        try {
          await query('SELECT set_config($1, $2, false)', [TENANT_SETTING, '']);
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          onResetFailure?.(err);
          await (runner as any).releasePostgresConnection(err).catch(() => undefined);
          throw err;
        }
      }
      return release();
    };
    return runner;
  };
}
