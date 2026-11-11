import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

/** [Epic 99] Who is really behind this request: a platform admin in a Login as session, or nobody. */
export interface ActorImpersonation {
  sid: string;
  pa: string;
}
interface ActorStore {
  imp: ActorImpersonation | null;
}

const storage = new AsyncLocalStorage<ActorStore>();

export const RequestActorContext = {
  run<T>(fn: () => T): T {
    return storage.run({ imp: null }, fn);
  },
  current(): ActorStore | undefined {
    return storage.getStore();
  },
  /** Mutates the store object, so it still works after an async hop that lost the context. Fails closed with no store. */
  setImpersonation(imp: ActorImpersonation): void {
    const store = storage.getStore();
    if (!store) throw new Error('request actor context missing');
    store.imp = imp;
  },
  impersonation(): ActorImpersonation | null {
    return storage.getStore()?.imp ?? null;
  },
};

export function requestActorContextMiddleware(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  RequestActorContext.run(next);
}

/**
 * Stamps an audit row from the request's Login as session. No store (queue worker,
 * script) or no `imp`: row untouched, because those rows are the system's own (D6).
 */
export function stampAuditActor<T extends object>(row: T): T {
  const imp = RequestActorContext.impersonation();
  if (imp) {
    Object.assign(row, {
      impersonated_by_platform_admin_id: imp.pa,
      impersonation_session_id: imp.sid,
    });
  }
  return row;
}
