import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import {
  ConflictException,
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
import { PlatformOpsSystemController } from './ops-system.controller';
import { OpsSystemService } from './ops-system.service';

const SCHOOL = '22222222-2222-4222-8222-222222222222';
const SYSTEM = '/platform/ops/system';
const RELEASE = `/platform/ops/restore-lock/${SCHOOL}/release`;

describe('PlatformOpsSystemController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { getSystem: vi.fn(), releaseRestoreLock: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.getSystem.mockResolvedValue({ appVersion: 'unknown' });
    svc.releaseRestoreLock.mockResolvedValue({ released: true, failedJobs: 1 });
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        if (!req.headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_OPS_ACTION);
        req.approval = { approverId: 'approver-1' };
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformOpsSystemController],
      providers: [{ provide: OpsSystemService, useValue: svc }],
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
    await supertest(app.getHttpServer()).get(SYSTEM).expect(401);
    await supertest(app.getHttpServer()).post(RELEASE).set('X-Approval-Token', 't').expect(401);
    expect(svc.getSystem).not.toHaveBeenCalled();
    expect(svc.releaseRestoreLock).not.toHaveBeenCalled();
  });

  it('GET answers the card with no-store', async () => {
    const res = await supertest(app.getHttpServer()).get(SYSTEM).expect(200);
    expect(res.body).toEqual({ appVersion: 'unknown' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('release without X-Approval-Token is 403 APPROVAL_REQUIRED and nothing releases', async () => {
    const res = await supertest(app.getHttpServer()).post(RELEASE).expect(403);
    expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUIRED');
    expect(svc.releaseRestoreLock).not.toHaveBeenCalled();
  });

  it('release passes the school id and prefers the approver id over the owner id', async () => {
    const res = await supertest(app.getHttpServer())
      .post(RELEASE)
      .set('X-Approval-Token', 't')
      .expect(200);
    expect(res.body).toEqual({ released: true, failedJobs: 1 });
    expect(svc.releaseRestoreLock).toHaveBeenCalledWith(SCHOOL, 'approver-1');
  });

  it('a non-UUID school id is 400 through ParseUUIDPipe and the service is not called', async () => {
    await supertest(app.getHttpServer())
      .post('/platform/ops/restore-lock/not-a-uuid/release')
      .set('X-Approval-Token', 't')
      .expect(400);
    expect(svc.releaseRestoreLock).not.toHaveBeenCalled();
  });

  it('unknown school is 404 and a live restore is 409 RESTORE_RUNNING', async () => {
    svc.releaseRestoreLock.mockRejectedValueOnce(new NotFoundException('School not found.'));
    const nf = await supertest(app.getHttpServer())
      .post(RELEASE)
      .set('X-Approval-Token', 't')
      .expect(404);
    expect(JSON.stringify(nf.body)).not.toContain(SCHOOL);
    svc.releaseRestoreLock.mockRejectedValueOnce(
      new ConflictException({ code: 'RESTORE_RUNNING', message: 'x' }),
    );
    const c = await supertest(app.getHttpServer())
      .post(RELEASE)
      .set('X-Approval-Token', 't')
      .expect(409);
    expect(JSON.stringify(c.body)).toContain('RESTORE_RUNNING');
  });

  it('the release route is approval-scoped and fail-closed without Redis (Rule 15)', () => {
    const handler = PlatformOpsSystemController.prototype.releaseLock;
    expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, handler)).toBe(
      ApprovalScope.PLATFORM_OPS_ACTION,
    );
    expect(Reflect.getMetadata(FAIL_CLOSED_WITHOUT_REDIS_KEY, handler)).toBe(true);
  });
});
