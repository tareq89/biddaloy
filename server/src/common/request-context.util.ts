import { Request } from 'express';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * request.ip already reflects X-Forwarded-For in production (main.ts sets
 * `trust proxy` there), so this stays correct behind nginx without extra
 * config — same basis same-origin.guard.ts's requestOrigin() relies on.
 */
export function requestContext(request: Request): RequestContext {
  return { ip: request.ip ?? null, userAgent: request.headers['user-agent'] ?? null };
}
