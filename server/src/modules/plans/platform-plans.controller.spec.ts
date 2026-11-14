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
import { ApprovalGuard } from '../auth/guards/approval.guard';
import { ApprovalRequiredException } from '../../common/errors/approval-required.exception';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { PlatformPlansController } from './platform-plans.controller';
import { PlansService } from './plans.service';

const ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_PLAN = `/platform/billing/schools/${ID}/plan`;

describe('PlatformPlansController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    makeDefault: vi.fn(),
    assign: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    for (const f of Object.values(svc)) f.mockResolvedValue({});
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        if (!ctx.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_PLAN);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformPlansController],
      providers: [{ provide: PlansService, useValue: svc }],
    })
      // The real cockpit-jwt strategy answers 401 for no token and for a school-app token.
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

  const http = () => supertest(app.getHttpServer());
  const create = { name: 'Gold', unit_price_paisa: 1000 };
  const assign = { plan_id: ID, reason: 'Agreed deal' };

  it('a school token (no cockpit identity) is 401 on every route and nothing runs', async () => {
    authed = false;
    await http().get('/platform/plans').expect(401);
    await http().post('/platform/plans').set('X-Approval-Token', 't').send(create).expect(401);
    await http().patch(`/platform/plans/${ID}`).set('X-Approval-Token', 't').send({}).expect(401);
    await http()
      .post(`/platform/plans/${ID}/make-default`)
      .set('X-Approval-Token', 't')
      .expect(401);
    await http().post(SCHOOL_PLAN).set('X-Approval-Token', 't').send(assign).expect(401);
    for (const f of Object.values(svc)) expect(f).not.toHaveBeenCalled();
  });

  it('every write without a step-up token is 403 APPROVAL_REQUIRED and changes nothing', async () => {
    await http().post('/platform/plans').send(create).expect(403);
    await http().patch(`/platform/plans/${ID}`).send({ active: false }).expect(403);
    await http().post(`/platform/plans/${ID}/make-default`).expect(403);
    await http().post(SCHOOL_PLAN).send(assign).expect(403);
    expect(svc.create).not.toHaveBeenCalled();
    expect(svc.update).not.toHaveBeenCalled();
    expect(svc.makeDefault).not.toHaveBeenCalled();
    expect(svc.assign).not.toHaveBeenCalled();
  });

  it('writes with a token reach the service as the cockpit user', async () => {
    await http().post('/platform/plans').set('X-Approval-Token', 't').send(create).expect(201);
    expect(svc.create).toHaveBeenCalledWith(create, expect.objectContaining({ userId: 'owner-1' }));
    await http().post(SCHOOL_PLAN).set('X-Approval-Token', 't').send(assign).expect(200);
    expect(svc.assign).toHaveBeenCalledWith(
      ID,
      assign,
      expect.objectContaining({ userId: 'owner-1' }),
    );
    await http().get('/platform/plans').expect(200);
  });

  it('a non-UUID :id is 400 and nothing runs', async () => {
    await http().patch('/platform/plans/nope').set('X-Approval-Token', 't').send({}).expect(400);
    await http().post('/platform/plans/nope/make-default').set('X-Approval-Token', 't').expect(400);
    await http()
      .post('/platform/billing/schools/nope/plan')
      .set('X-Approval-Token', 't')
      .send(assign)
      .expect(400);
    expect(svc.update).not.toHaveBeenCalled();
    expect(svc.makeDefault).not.toHaveBeenCalled();
    expect(svc.assign).not.toHaveBeenCalled();
  });

  it('there is no DELETE route', async () => {
    await http().delete(`/platform/plans/${ID}`).set('X-Approval-Token', 't').expect(404);
  });
});
