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
import { SmsBundleCatalogService } from '../catalog/sms-bundle-catalog.service';
import { SmsBundleOrdersController } from './sms-bundle-orders.controller';
import { SmsBundleOrdersService } from './sms-bundle-orders.service';

const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const SCHOOL_B = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';
const PKG = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';

/**
 * Real ContextGuard, RolesGuard and PermissionsGuard; only the JWT strategy and the tenant-status
 * lookup are stubbed. Deferred to #3866 (module wiring): the real AuthGuard('jwt'), the Redis-outage
 * 503 and the route snapshots.
 */
describe('SmsBundleOrdersController', () => {
  let app: INestApplication;
  let role: UserRole;
  const orders = { list: vi.fn(), get: vi.fn(), create: vi.fn() };
  const catalog = { listActive: vi.fn() };

  beforeAll(async () => {
    const jwtStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        if (!req.headers.authorization) return false; // Nest answers 403 for a false guard
        req.user = { sub: 'u1', memberships: [{ tenantId: SCHOOL_A, role }] };
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [SmsBundleOrdersController],
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
        { provide: SmsBundleOrdersService, useValue: orders },
        { provide: SmsBundleCatalogService, useValue: catalog },
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
    orders.list.mockResolvedValue([]);
    orders.get.mockResolvedValue({ id: ORDER });
    orders.create.mockResolvedValue({ id: ORDER });
    catalog.listActive.mockResolvedValue([]);
  });

  const req = (method: 'get' | 'post', path: string, tenant: string | null = SCHOOL_A) => {
    let r = supertest(app.getHttpServer())
      [method](`/sms-bundles/${path}`)
      .set('Authorization', 'Bearer t');
    if (tenant !== null) r = r.set('X-Tenant-ID', tenant);
    return r;
  };

  it('an ADMIN reads the catalog and lists orders of the header school only', async () => {
    await req('get', 'catalog').expect(200);
    await req('get', 'orders?limit=5').expect(200);
    expect(orders.list).toHaveBeenCalledWith(SCHOOL_A, 5, 0);
  });

  it('refuses a missing X-Tenant-ID (401), an invalid one (401) and a school not in the token (401)', async () => {
    await req('get', 'orders', null).expect(401);
    await req('get', 'orders', 'not-a-uuid').expect(401);
    await req('get', 'orders', SCHOOL_B).expect(401);
    await req('post', 'orders', SCHOOL_B)
      .send({ package_id: PKG, idempotency_key: KEY })
      .expect(401);
    expect(orders.list).not.toHaveBeenCalled();
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('a TEACHER and an EXECUTIVE get 403 on every route (SETTINGS_MANAGE is ADMIN only)', async () => {
    for (const r of [UserRole.TEACHER, UserRole.EXECUTIVE]) {
      role = r;
      await req('get', 'catalog').expect(403);
      await req('get', 'orders').expect(403);
      await req('get', `orders/${ORDER}`).expect(403);
      await req('post', 'orders').send({ package_id: PKG, idempotency_key: KEY }).expect(403);
    }
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('a non-UUID order id is 400; limit above 100 is 400', async () => {
    await req('get', 'orders/not-a-uuid').expect(400);
    await req('get', 'orders?limit=101').expect(400);
  });

  it('cross-tenant: the order id is looked up inside the caller’s school, a miss is the service’s 404', async () => {
    await req('get', `orders/${ORDER}`).expect(200);
    expect(orders.get).toHaveBeenCalledWith(SCHOOL_A, ORDER);
  });

  it('POST passes school, key and package to the service; a bad body never reaches it', async () => {
    await req('post', 'orders').send({ package_id: PKG, idempotency_key: KEY }).expect(201);
    expect(orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: SCHOOL_A, packageId: PKG, idempotencyKey: KEY }),
    );
    await req('post', 'orders').send({ package_id: PKG }).expect(400);
    await req('post', 'orders')
      .send({ package_id: PKG, idempotency_key: KEY, price_paisa: 1 })
      .expect(400);
    expect(orders.create).toHaveBeenCalledTimes(1);
  });
});
