import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprovalScope } from '@biddaloy/shared';
import {
  ForbiddenException,
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
import { ApprovalGuard } from '../../auth/guards/approval.guard';
import { TwoPersonGuard } from '../../platform-identity/approvals/two-person.guard';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { PlatformSchoolDeleteController } from './platform-school-delete.controller';
import { PlatformSchoolDeleteService } from './platform-school-delete.service';

const ID = '11111111-1111-4111-8111-111111111111';
const URL = `/platform/schools/${ID}`;
const BODY = { reason: 'Closed for good' };

describe('PlatformSchoolDeleteController', () => {
  let app: INestApplication;
  let authed: boolean;
  let otherOwner: boolean;
  const svc = { assertDeletable: vi.fn(), delete: vi.fn() };
  const twoPerson = { enforce: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    otherOwner = true;
    svc.assertDeletable.mockResolvedValue({ id: ID, name: 'N', slug: 's' });
    svc.delete.mockResolvedValue({ id: ID, deletedAt: new Date(0) });
    twoPerson.enforce.mockImplementation(async () => {
      if (!otherOwner) throw new HttpException({ details: { code: 'APPROVAL_REQUESTED' } }, 403);
    });
    const approvalStub: CanActivate = {
      canActivate: (c: ExecutionContext) => {
        if (!c.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ForbiddenException();
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformSchoolDeleteController],
      providers: [
        { provide: PlatformSchoolDeleteService, useValue: svc },
        { provide: TwoPersonGuard, useValue: twoPerson },
      ],
    })
      // The real cockpit-jwt strategy answers 401 for no token, a school-app token
      // (aud biddaloy:access) and an `imp` token; the stub stands for all three.
      .overrideGuard(AuthGuard('cockpit-jwt'))
      .useValue({
        canActivate: (c: ExecutionContext) => {
          if (!authed) throw new UnauthorizedException();
          c.switchToHttp().getRequest().user = { sub: 'owner-1' };
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

  const del = (url = URL, body: object = BODY) =>
    supertest(app.getHttpServer()).delete(url).set('X-Approval-Token', 't').send(body);

  it('no usable cockpit token (none, school-app, imp) is 401 and nothing runs', async () => {
    authed = false;
    await del().expect(401);
    expect(svc.delete).not.toHaveBeenCalled();
  });

  it('a bad uuid is 400 and a short reason is 400; no approval request is filed', async () => {
    await del('/platform/schools/not-a-uuid').expect(400);
    await del(URL, { reason: 'no' }).expect(400);
    expect(twoPerson.enforce).not.toHaveBeenCalled();
  });

  it('without the other owner the call answers APPROVAL_REQUESTED and nothing is deleted', async () => {
    otherOwner = false;
    const res = await del().expect(403);
    expect(res.body.details.code).toBe('APPROVAL_REQUESTED');
    expect(svc.delete).not.toHaveBeenCalled();
  });

  it('with both owners it deletes, scoped to PLATFORM_DELETE_SCHOOL', async () => {
    await del().expect(200);
    expect(twoPerson.enforce).toHaveBeenCalledWith(
      expect.anything(),
      ApprovalScope.PLATFORM_DELETE_SCHOOL,
      expect.objectContaining({ schoolId: ID, reason: BODY.reason }),
    );
    expect(svc.delete).toHaveBeenCalledWith(ID, BODY.reason, 'owner-1', expect.anything());
  });

  it('a missing step-up token is refused before anything runs', async () => {
    await supertest(app.getHttpServer()).delete(URL).send(BODY).expect(403);
    expect(svc.assertDeletable).not.toHaveBeenCalled();
  });
});
