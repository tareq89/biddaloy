import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnauthorizedException,
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { PlatformAuditController } from './platform-audit.controller';
import { PlatformAuditService } from './platform-audit.service';

const ID = '22222222-2222-4222-8222-222222222222';

describe('PlatformAuditController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { search: vi.fn(), sessions: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.search.mockResolvedValue({ items: [], nextCursor: null });
    svc.sessions.mockResolvedValue({ items: [], nextCursor: null });
    const mod = await Test.createTestingModule({
      controllers: [PlatformAuditController],
      providers: [{ provide: PlatformAuditService, useValue: svc }],
    })
      // The real cockpit-jwt strategy refuses school-app and imp tokens with 401.
      .overrideGuard(AuthGuard('cockpit-jwt'))
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!authed) throw new UnauthorizedException();
          ctx.switchToHttp().getRequest().user = { sub: 'owner-1', typ: 'cockpit' };
          return true;
        },
      })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  const http = () => supertest(app.getHttpServer());

  it('no usable token (none, school-app, imp) is 401 on both routes', async () => {
    authed = false;
    await http().get('/platform/audit').expect(401);
    await http().get('/platform/audit/sessions').expect(401);
    expect(svc.search).not.toHaveBeenCalled();
    expect(svc.sessions).not.toHaveBeenCalled();
  });

  it('bad uuid, bad action, bad date, limit 101 are 400', async () => {
    for (const qs of [
      'tenantId=nope',
      'actorId=nope',
      'sessionId=nope',
      'action=NOT_AN_ACTION',
      'from=yesterday',
      'to=x',
      'limit=101',
      'limit=0',
    ]) {
      await http().get(`/platform/audit?${qs}`).expect(400);
    }
    for (const qs of ['tenantId=nope', 'ownerId=nope', 'status=BOGUS', 'limit=101'])
      await http().get(`/platform/audit/sessions?${qs}`).expect(400);
    expect(svc.search).not.toHaveBeenCalled();
    expect(svc.sessions).not.toHaveBeenCalled();
  });

  it('valid filters reach the service; no-store', async () => {
    const res = await http()
      .get(
        `/platform/audit?tenantId=${ID}&action=IMPERSONATION_STARTED&from=2026-01-01T00:00:00Z&limit=100`,
      )
      .expect(200);
    expect(svc.search).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: ID, action: 'IMPERSONATION_STARTED', limit: 100 }),
    );
    expect(res.headers['cache-control']).toBe('no-store');
    await http().get(`/platform/audit/sessions?ownerId=${ID}&status=ACTIVE`).expect(200);
    expect(svc.sessions).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: ID, status: 'ACTIVE' }),
    );
  });
});
