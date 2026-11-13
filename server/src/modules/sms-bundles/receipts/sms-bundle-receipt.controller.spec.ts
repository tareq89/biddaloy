import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import {
  NotFoundException,
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
import { ReceiptService } from '../../billing/receipt.service';
import { SmsBundleReceiptController } from './sms-bundle-receipt.controller';

const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const SCHOOL_B = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';

/** Real Context/Roles/Permissions guards; only the JWT strategy and tenant status are stubbed. */
describe('SmsBundleReceiptController', () => {
  let app: INestApplication;
  let role: UserRole;
  const receipts = { renderBundleForSchool: vi.fn() };

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
      controllers: [SmsBundleReceiptController],
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
        { provide: ReceiptService, useValue: receipts },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue(jwtStub)
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    role = UserRole.ADMIN;
    receipts.renderBundleForSchool.mockResolvedValue('<html>receipt</html>');
  });

  const get = (id: string, tenant: string | null = SCHOOL_A) => {
    let r = supertest(app.getHttpServer())
      .get(`/sms-bundles/orders/${id}/receipt`)
      .set('Authorization', 'Bearer t');
    if (tenant !== null) r = r.set('X-Tenant-ID', tenant);
    return r;
  };

  it('an ADMIN gets the HTML, looked up inside the header school only', async () => {
    const res = await get(ORDER).expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toBe('<html>receipt</html>');
    expect(receipts.renderBundleForSchool).toHaveBeenCalledWith(SCHOOL_A, ORDER);
  });

  it('refuses a missing, invalid or foreign X-Tenant-ID (401)', async () => {
    await get(ORDER, null).expect(401);
    await get(ORDER, 'not-a-uuid').expect(401);
    await get(ORDER, SCHOOL_B).expect(401);
    expect(receipts.renderBundleForSchool).not.toHaveBeenCalled();
  });

  it('a TEACHER and an EXECUTIVE get 403 (SETTINGS_MANAGE is ADMIN only)', async () => {
    for (const r of [UserRole.TEACHER, UserRole.EXECUTIVE]) {
      role = r;
      await get(ORDER).expect(403);
    }
    expect(receipts.renderBundleForSchool).not.toHaveBeenCalled();
  });

  it('a non-UUID order id is 400', async () => {
    await get('not-a-uuid').expect(400);
  });

  it('cross-tenant: another school’s order is the service’s 404', async () => {
    receipts.renderBundleForSchool.mockRejectedValue(new NotFoundException('Receipt not found'));
    await get(ORDER).expect(404);
  });
});
