import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

/**
 * Defense-in-depth against CSRF on the two cookie-authenticated auth
 * routes (/auth/refresh, /auth/logout — see #48). SameSite=Strict on the
 * refresh cookie (token-cookie.ts) is the primary defense: it already
 * stops the browser from attaching the cookie to a cross-site request in
 * the first place. This is a second, independent check in case that
 * primary defense is ever weakened (a legacy browser ignoring SameSite, a
 * future relaxation to Lax for some other reason).
 *
 * Browsers send an Origin header on state-changing requests (POST, PUT,
 * PATCH, DELETE) for *every* such request, not only cross-origin ones — a
 * same-origin fetch/XHR POST carries it too. A request with no Origin
 * header at all is not something a browser sends for these methods, so
 * it's outside this check's threat model (a non-browser API client, curl,
 * a server-to-server call) and is passed through rather than rejected.
 */
export function isOriginAllowed(originHeader: string | undefined, expectedOrigin: string): boolean {
  if (!originHeader) return true;
  return originHeader === expectedOrigin;
}

/**
 * The origin this server believes it's being addressed as, reconstructed
 * from the request itself rather than a fixed config value — req.protocol
 * already reflects X-Forwarded-Proto in production (main.ts sets `trust
 * proxy` there), so this stays correct behind nginx without extra config.
 */
export function requestOrigin(request: Request): string {
  return `${request.protocol}://${request.get('host')}`;
}

@Injectable()
export class SameOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (!isOriginAllowed(request.headers.origin, requestOrigin(request))) {
      throw new ForbiddenException('Cross-origin request rejected');
    }
    return true;
  }
}
