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
import { PlatformSmsCatalogController } from './platform-sms-catalog.controller';
import { SmsBundleCatalogService } from './sms-bundle-catalog.service';

const ID = '11111111-1111-4111-8111-111111111111';
const BASE = '/platform/sms-packages';
const body = { name: 'Starter', smsCount: 100, validityDays: 30, priceTaka: 50 };

describe('PlatformSmsCatalogController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { listAll: vi.fn(), create: vi.fn(), update: vi.fn(), setActive: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.listAll.mockResolvedValue([]);
    svc.create.mockResolvedValue({ id: ID });
    svc.update.mockResolvedValue({ id: ID });
    svc.setActive.mockResolvedValue({ id: ID });
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        if (!ctx.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_PLAN);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformSmsCatalogController],
      providers: [{ provide: SmsBundleCatalogService, useValue: svc }],
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

  it('no usable token is 401 on every route and nothing runs', async () => {
    authed = false;
    await http().get(BASE).expect(401);
    await http().post(BASE).set('X-Approval-Token', 't').send(body).expect(401);
    await http().patch(`${BASE}/${ID}`).set('X-Approval-Token', 't').send({}).expect(401);
    await http().post(`${BASE}/${ID}/active`).send({ active: false }).expect(401);
    expect(svc.create).not.toHaveBeenCalled();
    expect(svc.update).not.toHaveBeenCalled();
    expect(svc.setActive).not.toHaveBeenCalled();
  });

  it('create and edit without step-up are 403 APPROVAL_REQUIRED and change nothing', async () => {
    const a = await http().post(BASE).send(body).expect(403);
    const b = await http().patch(`${BASE}/${ID}`).send({ priceTaka: 5 }).expect(403);
    expect(JSON.stringify(a.body)).toContain('APPROVAL_REQUIRED');
    expect(JSON.stringify(b.body)).toContain('APPROVAL_REQUIRED');
    expect(svc.create).not.toHaveBeenCalled();
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('create and edit with proof pass the owner id through', async () => {
    await http().post(BASE).set('X-Approval-Token', 't').send(body).expect(201);
    expect(svc.create).toHaveBeenCalledWith(body, expect.objectContaining({ userId: 'owner-1' }));
    await http()
      .patch(`${BASE}/${ID}`)
      .set('X-Approval-Token', 't')
      .send({ priceTaka: 5 })
      .expect(200);
    expect(svc.update).toHaveBeenCalledWith(
      ID,
      { priceTaka: 5 },
      expect.objectContaining({ userId: 'owner-1' }),
    );
  });

  it('toggle needs no step-up', async () => {
    await http().post(`${BASE}/${ID}/active`).send({ active: false }).expect(201);
    expect(svc.setActive).toHaveBeenCalledWith(ID, false, expect.anything());
    await http().post(`${BASE}/${ID}/active`).send({ active: 'no' }).expect(400);
  });

  it('bad bodies, bad UUIDs and big limits are 400; there is no delete route', async () => {
    const post = (b: object) =>
      http()
        .post(BASE)
        .set('X-Approval-Token', 't')
        .send({ ...body, ...b });
    await post({ smsCount: 99 }).expect(400);
    await post({ validityDays: 366 }).expect(400);
    await post({ priceTaka: 1.234 }).expect(400);
    await http().patch(`${BASE}/nope`).set('X-Approval-Token', 't').send({}).expect(400);
    await http().post(`${BASE}/nope/active`).send({ active: true }).expect(400);
    await http().get(`${BASE}?limit=101`).expect(400);
    await http().get(`${BASE}?limit=100`).expect(200);
    await http().delete(`${BASE}/${ID}`).set('X-Approval-Token', 't').expect(404);
    expect(svc.create).not.toHaveBeenCalled();
  });
});
