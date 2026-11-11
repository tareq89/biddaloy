import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import {
  DENY_WHEN_IMPERSONATING_KEY,
  DenyWhenImpersonatingOptions,
} from './decorators/deny-when-impersonating.decorator';

/**
 * Epic 99 D4. Global APP_INTERCEPTOR (registered by #3797): it runs after
 * AuthGuard('jwt'), so `request.user.imp` is set. A global guard would run first
 * and see no user. Fixed text, never echoes input (Rule 23).
 */
@Injectable()
export class DenyWhenImpersonatingInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const mark = this.reflector.getAllAndOverride<true | DenyWhenImpersonatingOptions | undefined>(
      DENY_WHEN_IMPERSONATING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!mark) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { imp?: unknown }; body?: unknown }>();
    if (!request.user?.imp) return next.handle();

    if (typeof mark === 'object' && mark.bodyKeys) {
      const body = request.body;
      const hit =
        body !== null &&
        typeof body === 'object' &&
        mark.bodyKeys.some((k) => (body as Record<string, unknown>)[k] !== undefined);
      if (!hit) return next.handle();
    }

    throw new ForbiddenException({
      message: 'This action is not available while Biddaloy support is signed in',
      details: { code: 'IMPERSONATION_DENIED' },
    });
  }
}
