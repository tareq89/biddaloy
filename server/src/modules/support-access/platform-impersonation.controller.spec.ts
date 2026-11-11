import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HttpException,
  UnauthorizedException,
  ValidationPipe,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { ApprovalGuard } from '../auth/guards/approval.guard';
import { ApprovalRequiredException } from '../../common/errors/approval-required.exception';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { ImpersonationCodeService } from './exchange/impersonation-code.service';
import { ImpersonationSessionService } from './sessions/impersonation-session.service';
import { PlatformImpersonationController } from './platform-impersonation.controller';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const URL = '/platform/impersonation';
const body = (over: object = {}) => ({
  schoolId: SCHOOL,
  role: 'ADMIN',
  targetUserId: TARGET,
  reason: 'Parent reported a fee problem',
  viewOnly: true,
  ...over,
});

describe('PlatformImpersonationController', () => {
  let app: INestApplication;
  let authed: boolean;
  const sessions = { create: vi.fn(), end: vi.fn(), listLive: vi.fn(), listRecent: vi.fn() };
  const codes = { issue: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    codes.issue.mockResolvedValue('one-time-code');
    sessions.listLive.mockResolvedValue([]);
    sessions.listRecent.mockResolvedValue([]);
    const approvalStub: CanActivate = {
      // Stands for the real ApprovalGuard: no X-Approval-Token means 403 APPROVAL_REQUIRED.
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        if (!req.headers['x-approval-token']) throw new ApprovalRequiredException();
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformImpersonationController],
      providers: [
        { provide: ImpersonationSessionService, useValue: sessions },
        { provide: ImpersonationCodeService, useValue: codes },
      ],
    })
      // The real cockpit-jwt strategy rejects school-app tokens (wrong audience) with 401.
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

  const post = (over: object = {}, token = true) => {
    const r = supertest(app.getHttpServer()).post(URL);
    if (token) r.set('X-Approval-Token', 't');
    return r.send(body(over));
  };

  it('no usable token (none or school-app) is 401', async () => {
    authed = false;
    await post().expect(401);
    await supertest(app.getHttpServer()).get(URL).expect(401);
    await supertest(app.getHttpServer()).delete(`${URL}/${SID}`).expect(401);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('missing X-Approval-Token is 403 APPROVAL_REQUIRED and nothing starts', async () => {
    const res = await post({}, false).expect(403);
    expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUIRED');
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a 9-character reason, non-UUID school, SUPER_ADMIN role', async () => {
    await post({ reason: '123456789' }).expect(400);
    await post({ schoolId: 'nope' }).expect(400);
    await post({ role: 'SUPER_ADMIN' }).expect(400);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('ACTIVE start answers with a one-time code, no-store, entryKind NORMAL, admin from the token', async () => {
    const expires = new Date('2026-11-12T10:00:00Z');
    sessions.create.mockResolvedValue({ id: SID, status: 'ACTIVE', expires_at: expires });
    const res = await post().expect(201);
    expect(res.body).toEqual({
      id: SID,
      status: 'ACTIVE',
      code: 'one-time-code',
      expiresAt: expires.toISOString(),
    });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ platformAdminId: 'owner-1', entryKind: 'NORMAL' }),
    );
  });

  it('REQUESTED start answers with no code', async () => {
    sessions.create.mockResolvedValue({ id: SID, status: 'REQUESTED', expires_at: null });
    const res = await post().expect(201);
    expect(res.body).toEqual({ id: SID, status: 'REQUESTED' });
    expect(codes.issue).not.toHaveBeenCalled();
  });

  it('a refused person (cross-tenant target) is the fixed 422 and issues no code', async () => {
    sessions.create.mockRejectedValue(
      new HttpException({ message: 'This person cannot be signed in as.' }, 422),
    );
    await post().expect(422);
    expect(codes.issue).not.toHaveBeenCalled();
  });

  it('end: first call 204, second (already over) 404 SESSION_NOT_FOUND, non-UUID 400', async () => {
    sessions.end.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const http = supertest(app.getHttpServer());
    await http.delete(`${URL}/${SID}`).expect(204);
    const res = await http.delete(`${URL}/${SID}`).expect(404);
    expect(res.body.code).toBe('SESSION_NOT_FOUND');
    await http.delete(`${URL}/nope`).expect(400);
  });

  it('list: live by default, recent on request, limit 101 is 400', async () => {
    const http = supertest(app.getHttpServer());
    const res = await http.get(URL).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(sessions.listLive).toHaveBeenCalledWith();
    await http.get(`${URL}?scope=recent&limit=10`).expect(200);
    expect(sessions.listRecent).toHaveBeenCalledWith({ limit: 10 });
    await http.get(`${URL}?limit=101`).expect(400);
    await http.get(`${URL}?scope=bogus`).expect(400);
  });
});
