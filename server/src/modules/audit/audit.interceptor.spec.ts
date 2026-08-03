import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { ExecutionContext, CallHandler } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
import { AUDITED_METADATA_KEY } from './decorators/audited.decorator';
import { AuditAction } from '@beton-boi/shared';

function contextFor(request: any): ExecutionContext {
  return {
    getHandler: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function handlerReturning(response: unknown): CallHandler {
  return { handle: () => of(response) };
}

describe('AuditInterceptor', () => {
  it('passes through untouched when the handler carries no @Audited metadata', async () => {
    const auditService = { record: vi.fn().mockResolvedValue(undefined) };
    const reflector = { get: vi.fn().mockReturnValue(undefined) };
    const interceptor = new AuditInterceptor(reflector as any, auditService as any);
    const request = { ip: '1.2.3.4', headers: {}, currentTenant: { id: 'tenant-1' }, user: { sub: 'user-1' } };

    const result = await interceptor
      .intercept(contextFor(request), handlerReturning({ id: 'inv-1' }))
      .toPromise();

    expect(result).toEqual({ id: 'inv-1' });
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('records the action using the response body as new_values, after the handler completes', async () => {
    const auditService = { record: vi.fn().mockResolvedValue(undefined) };
    const reflector = {
      get: vi.fn().mockReturnValue({ action: AuditAction.INVOICE_GENERATED, entityType: 'Invoice' }),
    };
    const interceptor = new AuditInterceptor(reflector as any, auditService as any);
    const request = {
      ip: '1.2.3.4',
      headers: { 'user-agent': 'test-agent' },
      currentTenant: { id: 'tenant-1', role: 'ADMIN' },
      user: { sub: 'user-1' },
    };
    const response = { id: 'inv-1', total_amount: 500 };

    await interceptor.intercept(contextFor(request), handlerReturning(response)).toPromise();

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.INVOICE_GENERATED,
        entity_type: 'Invoice',
        entity_id: 'inv-1',
        tenant_id: 'tenant-1',
        performed_by_user_id: 'user-1',
        ip_address: '1.2.3.4',
        user_agent: 'test-agent',
        new_values: response,
      }),
    );
  });

  it('records a null entity_id when the response has no string id', async () => {
    const auditService = { record: vi.fn().mockResolvedValue(undefined) };
    const reflector = {
      get: vi.fn().mockReturnValue({ action: AuditAction.INVOICE_GENERATED, entityType: 'Invoice' }),
    };
    const interceptor = new AuditInterceptor(reflector as any, auditService as any);
    const request = { ip: null, headers: {}, currentTenant: undefined, user: undefined };

    await interceptor.intercept(contextFor(request), handlerReturning({ ok: true })).toPromise();

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: null, tenant_id: null, performed_by_user_id: null }),
    );
  });

  // Second line of defense on top of AuditService.record()'s own fail-open
  // guard: even if that contract ever regressed, a rejected record() call
  // here must not surface as an unhandled promise rejection.
  it('does not let a rejected record() call escape as an unhandled rejection', async () => {
    const auditService = { record: vi.fn().mockRejectedValue(new Error('boom')) };
    const reflector = {
      get: vi.fn().mockReturnValue({ action: AuditAction.INVOICE_GENERATED, entityType: 'Invoice' }),
    };
    const interceptor = new AuditInterceptor(reflector as any, auditService as any);
    const request = { ip: null, headers: {}, currentTenant: undefined, user: undefined };

    const result = await interceptor.intercept(contextFor(request), handlerReturning({ id: 'inv-1' })).toPromise();

    expect(result).toEqual({ id: 'inv-1' });
    // Flush the microtask queue so the (already-attached) .catch() has a
    // chance to run before the test ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
