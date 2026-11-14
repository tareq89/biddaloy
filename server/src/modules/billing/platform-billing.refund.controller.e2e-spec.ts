import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { ApprovalService } from '../auth/guards/approval.guard';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { PlatformBillingController } from './platform-billing.controller';
import { PlatformBillingService } from './platform-billing.service';
import { RefundService } from './refund.service';

/** [100.3.06] Input rules of the two refund routes, with the guards open (their own specs cover them). */
describe('PlatformBillingController refund routes', () => {
  let app: INestApplication;
  const refunds = {
    refundSeatOrder: vi.fn().mockResolvedValue({ applied: true }),
    refundBundleOrder: vi.fn().mockResolvedValue({ applied: true }),
  };
  const open: CanActivate = {
    canActivate: (c: ExecutionContext) => {
      c.switchToHttp().getRequest().user = { sub: 'owner-1' };
      return true;
    },
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [PlatformBillingController],
      providers: [
        { provide: PlatformBillingService, useValue: {} },
        { provide: RefundService, useValue: refunds },
        {
          provide: ApprovalService,
          useValue: { consume: vi.fn().mockResolvedValue({ approverId: 'approver-1' }) },
        },
        Reflector,
      ],
    })
      .overrideGuard(AuthGuard(['jwt', 'cockpit-jwt']))
      .useValue(open)
      .overrideGuard(PlatformAdminGuard)
      .useValue(open)
      .overrideInterceptor(IdempotencyInterceptor)
      .useValue({ intercept: (_c: unknown, next: { handle: () => unknown }) => next.handle() })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
  });
  afterAll(async () => app.close());

  const post = (path: string, body: object, key: string | null = 'key-1') => {
    const r = supertest(app.getHttpServer()).post(`/platform/billing/${path}`);
    return (key ? r.set('Idempotency-Key', key) : r).send(body);
  };

  const checkRoute = async (
    route: 'orders' | 'sms-bundle-orders',
    fn: typeof refunds.refundSeatOrder,
  ) => {
    const id = randomUUID();
    await post(`${route}/not-a-uuid/refund`, { reason: 'Valid reason' }).expect(400);
    await post(`${route}/${id}/refund`, { reason: 'Valid reason' }, null).expect(400);
    await post(`${route}/${id}/refund`, { reason: 'abcd' }).expect(400);
    await post(`${route}/${id}/refund`, { reason: 'x'.repeat(301) }).expect(400);
    await post(`${route}/${id}/refund`, {}).expect(400);
    expect(fn).not.toHaveBeenCalled();
    await post(`${route}/${id}/refund`, { reason: ' Valid reason ' }).expect(200);
    expect(fn).toHaveBeenCalledWith(id, 'Valid reason', 'owner-1', 'approver-1');
    fn.mockClear();
  };

  it('orders: non-UUID 400, missing Idempotency-Key 400, reason 5..300', () =>
    checkRoute('orders', refunds.refundSeatOrder));

  it('sms-bundle-orders: non-UUID 400, missing Idempotency-Key 400, reason 5..300', () =>
    checkRoute('sms-bundle-orders', refunds.refundBundleOrder));
});
