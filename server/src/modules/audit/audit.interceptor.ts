import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { AUDITED_METADATA_KEY, AuditedMetadata } from './decorators/audited.decorator';
import { requestContext } from '../../common/request-context.util';

interface RequestWithTenant extends Request {
  currentTenant?: { id: string; role: string };
}

/**
 * Companion to @Audited() — handlers without that metadata pass straight
 * through untouched, so this can sit globally without becoming the blanket
 * interceptor the issue explicitly warned against.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditedMetadata | undefined>(AUDITED_METADATA_KEY, context.getHandler());
    if (!metadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithTenant>();
    const { ip, userAgent } = requestContext(request);
    const tenantId = request.currentTenant?.id ?? null;
    const userId = (request.user as { sub?: string } | undefined)?.sub ?? null;

    return next.handle().pipe(
      tap((response: unknown) => {
        const entityId =
          response && typeof response === 'object' && typeof (response as { id?: unknown }).id === 'string'
            ? (response as { id: string }).id
            : null;

        // Fire-and-forget: AuditService.record() already fails open (catches
        // and logs) when called without a manager, so there's nothing
        // meaningful to await here — awaiting would just add audit-write
        // latency to a response that's already been decided.
        void this.auditService.record({
          action: metadata.action,
          entity_type: metadata.entityType,
          entity_id: entityId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: ip,
          user_agent: userAgent,
          new_values: response && typeof response === 'object' ? (response as Record<string, unknown>) : null,
        });
      }),
    );
  }
}
