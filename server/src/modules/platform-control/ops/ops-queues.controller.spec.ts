import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import {
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { ApprovalRequiredException } from '../../../common/errors/approval-required.exception';
import { FAIL_CLOSED_WITHOUT_REDIS_KEY } from '../../../common/rate-limit/app-throttler.guard';
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import { REQUIRE_APPROVAL_KEY } from '../../auth/decorators/require-approval.decorator';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { PlatformOpsQueuesController } from './ops-queues.controller';
import { OpsQueuesService } from './ops-queues.service';

const URL = '/platform/ops/queues';

describe('PlatformOpsQueuesController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { list: vi.fn(), retryFailed: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.list.mockResolvedValue([{ name: 'communications', available: true, failed: 1 }]);
    svc.retryFailed.mockResolvedValue({ retried: 2 });
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        if (!ctx.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_OPS_ACTION);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformOpsQueuesController],
      providers: [{ provide: OpsQueuesService, useValue: svc }],
    })
      // The real cockpit-jwt strategy refuses school-app and imp tokens with 401.
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
    await app.init();
  });

  it('no usable token (none, school-app or imp) is 401 on both routes', async () => {
    authed = false;
    await supertest(app.getHttpServer()).get(URL).expect(401);
    await supertest(app.getHttpServer())
      .post(`${URL}/communications/retry-failed`)
      .set('X-Approval-Token', 't')
      .expect(401);
    expect(svc.list).not.toHaveBeenCalled();
    expect(svc.retryFailed).not.toHaveBeenCalled();
  });

  it('GET lists counts with no-store', async () => {
    const res = await supertest(app.getHttpServer()).get(URL).expect(200);
    expect(res.body).toEqual({
      queues: [{ name: 'communications', available: true, failed: 1 }],
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('retry without X-Approval-Token is 403 APPROVAL_REQUIRED and nothing retries', async () => {
    const res = await supertest(app.getHttpServer())
      .post(`${URL}/communications/retry-failed`)
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUIRED');
    expect(svc.retryFailed).not.toHaveBeenCalled();
  });

  it('retry passes the name and the owner id from the token', async () => {
    const res = await supertest(app.getHttpServer())
      .post(`${URL}/communications/retry-failed`)
      .set('X-Approval-Token', 't')
      .expect(200);
    expect(res.body).toEqual({ retried: 2 });
    expect(svc.retryFailed).toHaveBeenCalledWith('communications', 'owner-1');
  });

  it('a name outside OPS_QUEUES is 404 and the name is not echoed', async () => {
    svc.retryFailed.mockRejectedValue(new NotFoundException('Queue not found.'));
    const res = await supertest(app.getHttpServer())
      .post(`${URL}/not-a-queue/retry-failed`)
      .set('X-Approval-Token', 't')
      .expect(404);
    expect(JSON.stringify(res.body)).not.toContain('not-a-queue');
  });

  it('the retry route is marked approval-scoped and fail-closed without Redis (Rule 15)', () => {
    const handler = PlatformOpsQueuesController.prototype.retryFailed;
    expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, handler)).toBe(
      ApprovalScope.PLATFORM_OPS_ACTION,
    );
    expect(Reflect.getMetadata(FAIL_CLOSED_WITHOUT_REDIS_KEY, handler)).toBe(true);
  });
});
