import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  ValidationPipe,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { SchoolStatus, UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { TenantStatusService } from '../../schools/tenant-status.service';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { BkashService } from '../../billing/bkash/bkash.service';
import { SmsBundlePayController } from './sms-bundle-pay.controller';

const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const SCHOOL_B = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';

/** Real guards; JWT strategy and tenant status stubbed. Redis-outage 503 and snapshots: #3866. */
describe('SmsBundlePayController', () => {
  let app: INestApplication;
  let role: UserRole;
  const bkash = { startPayment: vi.fn() };

  beforeAll(async () => {
    const jwtStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        if (!req.headers.authorization) return false;
        req.user = { sub: 'u1', memberships: [{ tenantId: SCHOOL_A, role }] };
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [SmsBundlePayController],
      providers: [
        ContextGuard,
        RolesGuard,
        PermissionsGuard,
        {
          provide: TenantStatusService,
          useValue: {
            getStatus: async () => SchoolStatus.ACTIVE,
            getStatusReason: async () => null,
            isSuspendedForBilling: async () => false,
            getReadOnlyUntil: async () => null,
            isRestoring: async () => false,
          },
        },
        { provide: BkashService, useValue: bkash },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue(jwtStub)
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    role = UserRole.ADMIN;
    bkash.startPayment.mockResolvedValue({ bkash_url: 'https://pay' });
  });

  const pay = (path = ORDER, tenant: string | null = SCHOOL_A) => {
    let r = supertest(app.getHttpServer())
      .post(`/sms-bundles/orders/${path}/pay/bkash`)
      .set('Authorization', 'Bearer t');
    if (tenant !== null) r = r.set('X-Tenant-ID', tenant);
    return r;
  };

  it('an ADMIN starts payment for the header school only, as a BUNDLE', async () => {
    const res = await pay().expect(200);
    expect(res.body.bkash_url).toBe('https://pay');
    // The school comes from the header, never the body: another school's order is the service's 404.
    expect(bkash.startPayment).toHaveBeenCalledWith(SCHOOL_A, ORDER, 'BUNDLE');
  });

  it('refuses a missing X-Tenant-ID, an invalid one and a school not in the token (401)', async () => {
    await pay(ORDER, null).expect(401);
    await pay(ORDER, 'not-a-uuid').expect(401);
    await pay(ORDER, SCHOOL_B).expect(401);
    expect(bkash.startPayment).not.toHaveBeenCalled();
  });

  it('a TEACHER gets 403 and a non-UUID order id gets 400', async () => {
    role = UserRole.TEACHER;
    await pay().expect(403);
    role = UserRole.ADMIN;
    await pay('not-a-uuid').expect(400);
    expect(bkash.startPayment).not.toHaveBeenCalled();
  });
});
