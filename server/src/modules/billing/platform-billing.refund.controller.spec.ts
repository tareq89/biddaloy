import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { CanActivate, ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { PlatformAccessGuard } from '../platform-identity/platform-access.guard';
import { ApprovalGuard } from '../auth/guards/approval.guard';
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
        Reflector,
      ],
    })
      .overrideGuard(AuthGuard(['jwt', 'cockpit-jwt']))
      .useValue(open)
      .overrideGuard(PlatformAccessGuard)
      .useValue(open)
      .overrideGuard(ApprovalGuard)
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

  for (const route of ['orders', 'sms-bundle-orders']) {
    it(`${route}: non-UUID 400, missing Idempotency-Key 400, reason 5..300`, async () => {
      const id = randomUUID();
      await post(`${route}/not-a-uuid/refund`, { reason: 'Valid reason' }).expect(400);
      await post(`${route}/${id}/refund`, { reason: 'Valid reason' }, null).expect(400);
      await post(`${route}/${id}/refund`, { reason: 'abcd' }).expect(400);
      await post(`${route}/${id}/refund`, { reason: 'x'.repeat(301) }).expect(400);
      await post(`${route}/${id}/refund`, {}).expect(400);
      expect(refunds.refundSeatOrder).not.toHaveBeenCalled();
      expect(refunds.refundBundleOrder).not.toHaveBeenCalled();
      await post(`${route}/${id}/refund`, { reason: '  Valid reason  ' }).expect(200);
      const fn = route === 'orders' ? refunds.refundSeatOrder : refunds.refundBundleOrder;
      expect(fn).toHaveBeenCalledWith(id, 'Valid reason', 'owner-1');
      fn.mockClear();
    });
  }
});
