import { Request } from 'express';
import { randomUUID } from 'crypto';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * The request id every log line and Sentry event correlates on. An
 * incoming `X-Request-Id` (set by nginx, or a client that already has one
 * from a previous hop) is trusted as-is; otherwise a fresh one is minted.
 * Shared by `AllExceptionsFilter` and [15.1.2]'s pino request logger so
 * both name the same request the same id — split, they'd each mint their
 * own on a request with no incoming header, and a support ticket's log
 * line would never match its error response's `X-Request-Id`.
 */
export function resolveRequestId(request: Request): string {
  const incoming = request.headers['x-request-id'];
  return typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
}

/**
 * request.ip already reflects X-Forwarded-For in production (main.ts sets
 * `trust proxy` there), so this stays correct behind nginx without extra
 * config — same basis same-origin.guard.ts's requestOrigin() relies on.
 */
export function requestContext(request: Request): RequestContext {
  return { ip: request.ip ?? null, userAgent: request.headers['user-agent'] ?? null };
}
