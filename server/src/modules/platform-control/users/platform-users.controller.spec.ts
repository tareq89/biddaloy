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
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';

const ID = '22222222-2222-4222-8222-222222222222';

describe('PlatformUsersController', () => {
  let app: INestApplication;
  let authed: boolean;
  const users = { search: vi.fn(), logout: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    users.search.mockResolvedValue([]);
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        if (!ctx.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_SCHOOL_CONTROL);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformUsersController],
      providers: [{ provide: PlatformUsersService, useValue: users }],
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
      .overrideGuard(ApprovalGuard)
      .useValue(approvalStub)
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  const http = () => supertest(app.getHttpServer());

  it('no usable token (none, school-app, imp) is 401 on both routes', async () => {
    authed = false;
    await http().get('/platform/users?q=01712345').expect(401);
    await http().post(`/platform/users/${ID}/logout`).set('X-Approval-Token', 't').expect(401);
    expect(users.search).not.toHaveBeenCalled();
    expect(users.logout).not.toHaveBeenCalled();
  });

  it('q of 2 characters, missing q and limit 101 are 400', async () => {
    await http().get('/platform/users?q=ab').expect(400);
    await http().get('/platform/users').expect(400);
    await http().get('/platform/users?q=01712345&limit=101').expect(400);
    expect(users.search).not.toHaveBeenCalled();
  });

  it('search trims q, passes limit, is no-store', async () => {
    const res = await http().get('/platform/users?q=%20%2B8801712345%20&limit=10').expect(200);
    expect(users.search).toHaveBeenCalledWith('+8801712345', 10);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('logout: bad UUID is 400, missing approval token is 403, ok is 204 with the actor from the token', async () => {
    await http().post('/platform/users/nope/logout').set('X-Approval-Token', 't').expect(400);
    const denied = await http().post(`/platform/users/${ID}/logout`).expect(403);
    expect(JSON.stringify(denied.body)).toContain('APPROVAL_REQUIRED');
    expect(users.logout).not.toHaveBeenCalled();
    await http().post(`/platform/users/${ID}/logout`).set('X-Approval-Token', 't').expect(204);
    expect(users.logout).toHaveBeenCalledWith(ID, 'owner-1');
  });
});
