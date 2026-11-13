import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { UserRole } from '@biddaloy/shared';
import { ContextGuard, RolesGuard } from '../../auth/guards/context.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { DenyWhenImpersonatingInterceptor } from '../../auth/deny-when-impersonating.interceptor';
import { SupportRequestsController } from './support-requests.controller';
import { SupportRequestsService } from './support-requests.service';

const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';

describe('SupportRequestsController', () => {
  let app: INestApplication;
  let role: UserRole;
  let imp: boolean;
  let tenantHeader: string | undefined;
  const service = { list: vi.fn(), get: vi.fn(), approve: vi.fn(), deny: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    role = UserRole.ADMIN;
    imp = false;
    tenantHeader = SCHOOL_A;
    service.list.mockResolvedValue([]);
    service.get.mockResolvedValue({ id: SID });
    service.approve.mockResolvedValue({});
    service.deny.mockResolvedValue({});
    const mod = await Test.createTestingModule({
      controllers: [SupportRequestsController],
      providers: [
        { provide: SupportRequestsService, useValue: service },
        DenyWhenImpersonatingInterceptor,
        Reflector,
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (c: any) => {
          const req = c.switchToHttp().getRequest();
          req.user = { sub: ADMIN, ...(imp ? { imp: {} } : {}) };
          return true;
        },
      })
      // Stand-in for ContextGuard: 400 for a missing or malformed X-Tenant-ID.
      .overrideGuard(ContextGuard)
      .useValue({
        canActivate: (c: any) => {
          const req = c.switchToHttp().getRequest();
          const h = req.headers['x-tenant-id'];
          if (!h || !/^[0-9a-f-]{36}$/.test(h)) throw new BadRequestException('Invalid tenant');
          req.currentTenant = { id: h, role };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalInterceptors(mod.get(DenyWhenImpersonatingInterceptor));
    await app.init();
  });

  const call = (m: 'get' | 'post', path: string) => {
    const r = supertest(app.getHttpServer())[m](`/support-access/requests${path}`);
    return tenantHeader !== undefined ? r.set('X-Tenant-ID', tenantHeader) : r;
  };

  it('GET :id reads one request of the header tenant; bad id 400, bad tenant 400', async () => {
    await call('get', `/${SID}`).expect(200);
    expect(service.get).toHaveBeenCalledWith(SCHOOL_A, SID);
    await call('get', '/not-a-uuid').expect(400);
    tenantHeader = undefined;
    await call('get', `/${SID}`).expect(400);
    tenantHeader = 'nope';
    await call('get', `/${SID}`).expect(400);
  });

  it('list takes page and refuses page 0', async () => {
    await call('get', '?page=2&limit=100').expect(200);
    expect(service.list).toHaveBeenCalledWith(SCHOOL_A, undefined, 100, 2);
    await call('get', '?page=0').expect(400);
  });

  it('ADMIN lists, approves and denies; tenant comes from the header', async () => {
    await call('get', '?status=decided&limit=100').expect(200);
    await call('post', `/${SID}/approve`).expect(200);
    await call('post', `/${SID}/deny`).expect(200);
    expect(service.list).toHaveBeenCalledWith(SCHOOL_A, 'decided', 100, undefined);
    expect(service.approve).toHaveBeenCalledWith(SCHOOL_A, ADMIN, SID, expect.anything());
    expect(service.deny).toHaveBeenCalledWith(SCHOOL_A, ADMIN, SID, expect.anything());
  });

  it('EXECUTIVE and TEACHER get 403 on every route', async () => {
    for (const r of [UserRole.EXECUTIVE, UserRole.TEACHER]) {
      role = r;
      await call('get', '').expect(403);
      await call('post', `/${SID}/approve`).expect(403);
      await call('post', `/${SID}/deny`).expect(403);
    }
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('missing or invalid X-Tenant-ID is 400 and nothing runs', async () => {
    tenantHeader = undefined;
    await call('get', '').expect(400);
    tenantHeader = 'not-a-uuid';
    await call('post', `/${SID}/approve`).expect(400);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('an imp token gets 403 on approve and deny, not on the list', async () => {
    imp = true;
    await call('post', `/${SID}/approve`).expect(403);
    await call('post', `/${SID}/deny`).expect(403);
    expect(service.approve).not.toHaveBeenCalled();
    expect(service.deny).not.toHaveBeenCalled();
    await call('get', '').expect(200);
  });

  it('limit above 100, limit 0, bad status and a non-UUID id are 400', async () => {
    await call('get', '?limit=101').expect(400);
    await call('get', '?limit=0').expect(400);
    await call('get', '?status=all').expect(400);
    await call('post', '/not-a-uuid/approve').expect(400);
    expect(service.list).not.toHaveBeenCalled();
  });
});
