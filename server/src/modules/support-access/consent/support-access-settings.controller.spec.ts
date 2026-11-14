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
import { SupportAccessSettingsController } from './support-access-settings.controller';
import { SupportAccessSettingsService } from './support-access-settings.service';

const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';

describe('SupportAccessSettingsController', () => {
  let app: INestApplication;
  let role: UserRole;
  let imp: boolean;
  let tenantHeader: string | undefined;
  const service = { get: vi.fn(), confirm: vi.fn(), changeMode: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    role = UserRole.ADMIN;
    imp = false;
    tenantHeader = SCHOOL_A;
    service.get.mockResolvedValue({});
    service.confirm.mockResolvedValue({});
    service.changeMode.mockResolvedValue({});
    const mod = await Test.createTestingModule({
      controllers: [SupportAccessSettingsController],
      providers: [
        { provide: SupportAccessSettingsService, useValue: service },
        DenyWhenImpersonatingInterceptor,
        Reflector,
        {
          provide: ModuleStateReader,
          useValue: { forTenant: async () => ({ platform: {}, school: {} }) },
        },
      ],
    })
      // Auth + context stand-in: sets the same request fields ContextGuard does, and mimics its
      // 400/403 for a missing or malformed X-Tenant-ID.
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (c: any) => {
          const req = c.switchToHttp().getRequest();
          req.user = { sub: ADMIN, ...(imp ? { imp: {} } : {}) };
          return true;
        },
      })
      .overrideGuard(ContextGuard)
      .useValue({
        canActivate: (c: any) => {
          const req = c.switchToHttp().getRequest();
          const h = req.headers['x-tenant-id'];
          if (!h || !/^[0-9a-f-]{36}$/.test(h)) {
            throw new BadRequestException('Invalid tenant');
          }
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

  const call = (m: 'get' | 'put' | 'post', path: string, body?: object) => {
    let r = supertest(app.getHttpServer())[m](`/support-access/${path}`);
    if (tenantHeader !== undefined) r = r.set('X-Tenant-ID', tenantHeader);
    return body ? r.send(body) : r;
  };

  it('ADMIN reads, confirms and changes; tenant comes from the header, not the body', async () => {
    await call('get', 'settings').expect(200);
    await call('post', 'confirm', { allowed: true, textVersion: 1 }).expect(200);
    await call('put', 'settings', { mode: 'ask', schoolId: 'other' }).expect(200);
    expect(service.get).toHaveBeenCalledWith(SCHOOL_A);
    expect(service.changeMode).toHaveBeenCalledWith(SCHOOL_A, ADMIN, 'ask', expect.anything());
  });

  it('EXECUTIVE and TEACHER get 403 on every route', async () => {
    for (const r of [UserRole.EXECUTIVE, UserRole.TEACHER]) {
      role = r;
      await call('get', 'settings').expect(403);
      await call('put', 'settings', { mode: 'ask' }).expect(403);
      await call('post', 'confirm', { allowed: true, textVersion: 1 }).expect(403);
    }
    expect(service.changeMode).not.toHaveBeenCalled();
  });

  it('missing or invalid X-Tenant-ID is 400 and nothing runs', async () => {
    tenantHeader = undefined;
    await call('get', 'settings').expect(400);
    tenantHeader = 'not-a-uuid';
    await call('put', 'settings', { mode: 'ask' }).expect(400);
    expect(service.changeMode).not.toHaveBeenCalled();
  });

  it('an imp token gets 403 on the writes, not on the read', async () => {
    imp = true;
    await call('put', 'settings', { mode: 'blocked' }).expect(403);
    await call('post', 'confirm', { allowed: false, textVersion: 1 }).expect(403);
    expect(service.changeMode).not.toHaveBeenCalled();
    expect(service.confirm).not.toHaveBeenCalled();
    await call('get', 'settings').expect(200);
  });

  it('bad bodies are 400', async () => {
    await call('put', 'settings', { mode: 'off' }).expect(400);
    await call('post', 'confirm', { allowed: 'yes' }).expect(400);
  });
});
