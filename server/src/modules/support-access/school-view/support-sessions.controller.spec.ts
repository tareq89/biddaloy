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
import { ModuleStateReader } from '../../auth/guards/module-state.reader';
import { DenyWhenImpersonatingInterceptor } from '../../auth/deny-when-impersonating.interceptor';
import { SupportSessionsController } from './support-sessions.controller';
import { SupportSessionsService } from './support-sessions.service';

const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';

describe('SupportSessionsController', () => {
  let app: INestApplication;
  let role: UserRole;
  let imp: boolean;
  let tenantHeader: string | undefined;
  const service = { listSessions: vi.fn(), listPlatformActions: vi.fn(), end: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    role = UserRole.ADMIN;
    imp = false;
    tenantHeader = SCHOOL_A;
    service.listSessions.mockResolvedValue([]);
    service.listPlatformActions.mockResolvedValue([]);
    service.end.mockResolvedValue({ id: SID, status: 'ENDED' });
    const mod = await Test.createTestingModule({
      controllers: [SupportSessionsController],
      providers: [
        { provide: SupportSessionsService, useValue: service },
        DenyWhenImpersonatingInterceptor,
        Reflector,
        {
          provide: ModuleStateReader,
          useValue: { forTenant: async () => ({ platform: {}, school: {} }) },
        },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (c: any) => {
          c.switchToHttp().getRequest().user = { sub: ADMIN, ...(imp ? { imp: {} } : {}) };
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
    const r = supertest(app.getHttpServer())[m](`/support-access${path}`);
    return tenantHeader !== undefined ? r.set('X-Tenant-ID', tenantHeader) : r;
  };

  it('ADMIN lists, sees platform actions and ends; tenant comes from the header', async () => {
    await call('get', '/sessions?days=30&page=2&limit=100').expect(200);
    await call('get', '/platform-actions').expect(200);
    await call('post', `/sessions/${SID}/end`).expect(200);
    expect(service.listSessions).toHaveBeenCalledWith(
      SCHOOL_A,
      expect.objectContaining({ days: 30, page: 2, limit: 100 }),
    );
    expect(service.end).toHaveBeenCalledWith(SCHOOL_A, SID);
  });

  it('EXECUTIVE and TEACHER get 403 on every route', async () => {
    for (const r of [UserRole.EXECUTIVE, UserRole.TEACHER]) {
      role = r;
      await call('get', '/sessions').expect(403);
      await call('get', '/platform-actions').expect(403);
      await call('post', `/sessions/${SID}/end`).expect(403);
    }
    expect(service.end).not.toHaveBeenCalled();
  });

  it('missing or invalid X-Tenant-ID is 400 and nothing runs', async () => {
    tenantHeader = undefined;
    await call('get', '/sessions').expect(400);
    tenantHeader = 'not-a-uuid';
    await call('post', `/sessions/${SID}/end`).expect(400);
    expect(service.end).not.toHaveBeenCalled();
  });

  it('an imp token may list and end (ending access is always safe, not deny-listed)', async () => {
    imp = true;
    await call('get', '/sessions').expect(200);
    await call('post', `/sessions/${SID}/end`).expect(200);
    expect(service.end).toHaveBeenCalled();
  });

  it('days above 90 (400 not clamped), limit above 100, limit 0, page 0 and a non-UUID id are 400', async () => {
    await call('get', '/sessions?days=400').expect(400);
    await call('get', '/platform-actions?days=91').expect(400);
    await call('get', '/sessions?limit=101').expect(400);
    await call('get', '/sessions?limit=0').expect(400);
    await call('get', '/sessions?page=0').expect(400);
    await call('post', '/sessions/not-a-uuid/end').expect(400);
    expect(service.listSessions).not.toHaveBeenCalled();
    expect(service.end).not.toHaveBeenCalled();
  });
});
