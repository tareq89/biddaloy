import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
  ValidationPipe,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { ApprovalRequiredException } from '../../../common/errors/approval-required.exception';
import { FAIL_CLOSED_WITHOUT_REDIS_KEY } from '../../../common/rate-limit/app-throttler.guard';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { REQUIRE_APPROVAL_KEY } from '../../auth/decorators/require-approval.decorator';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import { TwoPersonGuard } from '../../platform-identity/approvals/two-person.guard';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import { PlatformAnnouncementsController } from './platform-announcements.controller';
import { PlatformAnnouncementsService } from './platform-announcements.service';

const URL = '/platform/announcements';
const body = {
  title: 'Maintenance',
  body: 'Tonight at 10',
  severity: 'WARNING',
  statusFilter: ['ACTIVE'],
  sms: false,
  email: true,
};

describe('PlatformAnnouncementsController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { list: vi.fn(), preview: vi.fn(), send: vi.fn() };
  const twoPerson = { enforce: vi.fn() };
  // The real IdempotencyInterceptor runs against this in-memory Redis.
  const store = new Map<string, string>();
  const redis = {
    set: vi.fn(async (k: string, v: string, ...a: unknown[]) => {
      if (a.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    del: vi.fn(async (k: string) => void store.delete(k)),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    store.clear();
    authed = true;
    svc.list.mockResolvedValue({ items: [], total: 0 });
    svc.preview.mockResolvedValue({ schools: 2, people: 3 });
    svc.send.mockResolvedValue({ id: 'a1' });
    twoPerson.enforce.mockResolvedValue(undefined);
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        if (!ctx.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_ANNOUNCE_ALL);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformAnnouncementsController],
      providers: [
        { provide: PlatformAnnouncementsService, useValue: svc },
        { provide: TwoPersonGuard, useValue: twoPerson },
        { provide: TENANT_STATUS_REDIS, useValue: redis },
      ],
    })
      // The real cockpit-jwt strategy refuses school-app (aud biddaloy:access) and imp tokens.
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
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
  });

  const post = (path = '', key: string | null = 'k-1', token = true) => {
    let r = supertest(app.getHttpServer()).post(`${URL}${path}`);
    if (token) r = r.set('X-Approval-Token', 't');
    if (key) r = r.set('Idempotency-Key', key);
    return r;
  };

  it('no usable token (none, school-app or imp) is 401 on every route', async () => {
    authed = false;
    await supertest(app.getHttpServer()).get(URL).expect(401);
    await post('/preview').send(body).expect(401);
    await post().send(body).expect(401);
    expect(svc.send).not.toHaveBeenCalled();
  });

  it('without the other owner the send is APPROVAL_REQUESTED and nothing is sent', async () => {
    twoPerson.enforce.mockRejectedValue(
      new HttpException({ details: { code: 'APPROVAL_REQUESTED' } }, HttpStatus.FORBIDDEN),
    );
    const res = await post().send(body).expect(403);
    expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUESTED');
    expect(svc.send).not.toHaveBeenCalled();
  });

  it('without a step-up token the send is 403 APPROVAL_REQUIRED', async () => {
    const res = await post('', 'k-1', false).send(body).expect(403);
    expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUIRED');
    expect(svc.send).not.toHaveBeenCalled();
  });

  it('approved send passes owner id, body and key to the service', async () => {
    await post().send(body).expect(201);
    expect(svc.send).toHaveBeenCalledWith('owner-1', expect.objectContaining(body), 'k-1');
    expect(twoPerson.enforce).toHaveBeenCalledWith(
      expect.anything(),
      ApprovalScope.PLATFORM_ANNOUNCE_ALL,
      expect.not.objectContaining({ body: expect.anything() }),
    );
  });

  it('the same Idempotency-Key replays the first answer and sends once', async () => {
    await post().send(body).expect(201);
    await post().send(body).expect(201);
    expect(svc.send).toHaveBeenCalledTimes(1);
  });

  it('a missing Idempotency-Key is 400 and nothing is asked of the other owner', async () => {
    await post('', null).send(body).expect(400);
    expect(svc.send).not.toHaveBeenCalled();
    expect(twoPerson.enforce).not.toHaveBeenCalled();
  });

  it('a title over the cap, an empty filter and an unknown field are 400', async () => {
    await post()
      .send({ ...body, title: 'x'.repeat(141) })
      .expect(400);
    await post()
      .send({ ...body, statusFilter: [] })
      .expect(400);
    await post()
      .send({ ...body, extra: 1 })
      .expect(400);
    expect(twoPerson.enforce).not.toHaveBeenCalled(); // a bad body files no approval request
    expect(svc.send).not.toHaveBeenCalled();
  });

  it('preview writes nothing and answers counts', async () => {
    const res = await post('/preview', null, false)
      .send({ statusFilter: ['ACTIVE'] })
      .expect(200);
    expect(res.body).toEqual({ schools: 2, people: 3 });
    expect(svc.send).not.toHaveBeenCalled();
  });

  it('GET list: limit over 100 is 400, valid is 200 with no-store', async () => {
    await supertest(app.getHttpServer()).get(`${URL}?limit=101`).expect(400);
    const res = await supertest(app.getHttpServer()).get(`${URL}?limit=100`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(svc.list).toHaveBeenCalledWith(100, undefined);
  });

  it('the send route is approval-scoped and fail-closed without Redis (Rule 15)', () => {
    const h = PlatformAnnouncementsController.prototype.send;
    expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, h)).toBe(ApprovalScope.PLATFORM_ANNOUNCE_ALL);
    expect(Reflect.getMetadata(FAIL_CLOSED_WITHOUT_REDIS_KEY, h)).toBe(true);
  });
});
