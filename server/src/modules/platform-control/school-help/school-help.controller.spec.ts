import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import {
  UnauthorizedException,
  ValidationPipe,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import { ApprovalRequiredException } from '../../../common/errors/approval-required.exception';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { SchoolHelpController } from './school-help.controller';
import { SchoolHelpService } from './school-help.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const RESET = `/platform/schools/${SCHOOL}/admins/${USER}/reset-link`;
const LOGOUT = `/platform/schools/${SCHOOL}/logout-all`;

describe('SchoolHelpController', () => {
  let app: INestApplication;
  let authed: boolean;
  const help = { sendAdminResetLink: vi.fn(), logoutAll: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    help.sendAdminResetLink.mockResolvedValue({ channel: 'EMAIL', expiresAt: 'x' });
    help.logoutAll.mockResolvedValue({ usersSignedOut: 3 });
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        if (!ctx.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_SCHOOL_CONTROL);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [SchoolHelpController],
      providers: [{ provide: SchoolHelpService, useValue: help }],
    })
      // The real cockpit-jwt strategy answers 401 for no token, a school-app token
      // (aud biddaloy:access) and an `imp` token; the stub stands for all three.
      .overrideGuard(AuthGuard('cockpit-jwt'))
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!authed) throw new UnauthorizedException();
          ctx.switchToHttp().getRequest().user = { sub: 'owner-1' };
          return true;
        },
      })
      .overrideGuard(PlatformAdminGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ApprovalGuard)
      .useValue(approvalStub)
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  const post = (url: string, token = true) => {
    const r = supertest(app.getHttpServer()).post(url);
    return token ? r.set('X-Approval-Token', 't') : r;
  };

  it('no usable cockpit token (none, school-app, imp) is 401 and nothing runs', async () => {
    authed = false;
    await post(RESET).expect(401);
    await post(LOGOUT).expect(401);
    expect(help.sendAdminResetLink).not.toHaveBeenCalled();
    expect(help.logoutAll).not.toHaveBeenCalled();
  });

  it('missing X-Approval-Token is 403 APPROVAL_REQUIRED', async () => {
    const res = await post(RESET, false).expect(403);
    expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUIRED');
    await post(LOGOUT, false).expect(403);
    expect(help.logoutAll).not.toHaveBeenCalled();
  });

  it('a non-UUID school or user id is 400 through ParseUUIDPipe', async () => {
    await post(`/platform/schools/nope/admins/${USER}/reset-link`).expect(400);
    await post(`/platform/schools/${SCHOOL}/admins/nope/reset-link`).expect(400);
    await post('/platform/schools/nope/logout-all').expect(400);
    expect(help.sendAdminResetLink).not.toHaveBeenCalled();
  });

  it('reset-link passes the owner id from the token and answers no-store', async () => {
    const res = await post(RESET).expect(201);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(help.sendAdminResetLink).toHaveBeenCalledWith(
      SCHOOL,
      USER,
      'owner-1',
      expect.any(Object),
    );
  });

  it('logout-all answers the count', async () => {
    const res = await post(LOGOUT).expect(200);
    expect(res.body).toEqual({ usersSignedOut: 3 });
    expect(help.logoutAll).toHaveBeenCalledWith(SCHOOL, 'owner-1', expect.any(Object));
  });
});
