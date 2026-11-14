import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
  ValidationPipe,
  type CallHandler,
  type CanActivate,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { ApprovalGuard } from '../auth/guards/approval.guard';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { TwoPersonGuard } from '../platform-identity/approvals/two-person.guard';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { PlatformCouponsController } from './platform-coupons.controller';
import { CouponsService } from './coupons.service';

const ID = '11111111-1111-4111-8111-111111111111';
const BODY = {
  code: 'WELCOME10',
  discount_kind: 'PERCENT',
  percent: 10,
  starts_at: '2026-12-01T00:00:00.000Z',
  ends_at: '2027-01-01T00:00:00.000Z',
};
const FREE_BODY = {
  code: 'FREEYEAR',
  starts_at: BODY.starts_at,
  ends_at: BODY.ends_at,
};

describe('PlatformCouponsController', () => {
  let app: INestApplication;
  let authed: boolean;
  let otherOwner: boolean;
  const svc = {
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    usage: vi.fn(),
    isFree: vi.fn(),
  };
  const enforce = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    otherOwner = true;
    svc.create.mockResolvedValue({ id: ID });
    svc.isFree.mockResolvedValue(false);
    enforce.mockResolvedValue(undefined);
    svc.update.mockResolvedValue({ id: ID });
    svc.list.mockResolvedValue({ items: [], nextCursor: null });
    svc.usage.mockResolvedValue({ uses: 0 });
    const approvalStub: CanActivate = {
      canActivate: (c: ExecutionContext) => {
        if (!c.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ForbiddenException();
        return true;
      },
    };
    const twoPersonStub: CanActivate = {
      canActivate: () => {
        if (!otherOwner) throw new HttpException({ details: { code: 'APPROVAL_REQUESTED' } }, 403);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformCouponsController],
      providers: [
        { provide: CouponsService, useValue: svc },
        { provide: TwoPersonGuard, useValue: { enforce, canActivate: twoPersonStub.canActivate } },
      ],
    })
      // A school-app token and an `imp` token are 401 on the real cockpit strategy; the stub stands for them.
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
      .overrideGuard(TwoPersonGuard)
      .useValue(twoPersonStub)
      .overrideGuard(ApprovalGuard)
      .useValue(approvalStub)
      .overrideInterceptor(IdempotencyInterceptor)
      .useValue({ intercept: (_c: ExecutionContext, next: CallHandler) => next.handle() })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  const http = () => supertest(app.getHttpServer());
  const post = (url: string, body: object, key: string | null = 'k1', approved = true) => {
    let r = http().post(url);
    if (approved) r = r.set('X-Approval-Token', 't');
    if (key) r = r.set('Idempotency-Key', key);
    return r.send(body);
  };

  it('a school token (no cockpit identity) is refused on every route, nothing runs', async () => {
    authed = false;
    await http().get('/platform/coupons').expect(401);
    await http().get(`/platform/coupons/${ID}/usage`).expect(401);
    await post('/platform/coupons', BODY).expect(401);
    await post('/platform/coupons/free', FREE_BODY).expect(401);
    await http().patch(`/platform/coupons/${ID}`).set('X-Approval-Token', 't').send({}).expect(401);
    expect(svc.create).not.toHaveBeenCalled();
    expect(svc.update).not.toHaveBeenCalled();
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('create without a step-up token is refused', async () => {
    await post('/platform/coupons', BODY, 'k1', false).expect(403);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('create without an Idempotency-Key is 400', async () => {
    await post('/platform/coupons', BODY, null).expect(400);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('create with the key and token reaches the service as a non-free coupon', async () => {
    await post('/platform/coupons', BODY).expect(201);
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'WELCOME10' }),
      { free: false },
      expect.objectContaining({ userId: 'owner-1' }),
    );
  });

  it('a body with a bad code or out-of-range percent is 400', async () => {
    await post('/platform/coupons', { ...BODY, code: 'ab' }).expect(400);
    await post('/platform/coupons', { ...BODY, percent: 101 }).expect(400);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('the free route without the other owner is refused and nothing is created', async () => {
    otherOwner = false;
    const res = await post('/platform/coupons/free', FREE_BODY).expect(403);
    expect(res.body.details.code).toBe('APPROVAL_REQUESTED');
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('the free route without a step-up token is refused', async () => {
    await post('/platform/coupons/free', FREE_BODY, 'k1', false).expect(403);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('the free route with both approvals creates a free coupon; a client percent is ignored', async () => {
    await post('/platform/coupons/free', { ...FREE_BODY, percent: 5 }).expect(201);
    const [dto, opts] = svc.create.mock.calls[0];
    expect(opts).toEqual({ free: true });
    expect(dto.percent).toBeUndefined();
  });

  it('free without an Idempotency-Key is 400', async () => {
    await post('/platform/coupons/free', FREE_BODY, null).expect(400);
  });

  it('PATCH on a stored free coupon needs the strict second owner; a plain coupon does not', async () => {
    await http()
      .patch(`/platform/coupons/${ID}`)
      .set('X-Approval-Token', 't')
      .send({ max_uses: 9 })
      .expect(200);
    expect(enforce).not.toHaveBeenCalled();
    svc.isFree.mockResolvedValue(true);
    await http()
      .patch(`/platform/coupons/${ID}`)
      .set('X-Approval-Token', 't')
      .send({ max_uses: 9 })
      .expect(200);
    expect(enforce.mock.calls[0][3]).toBe(true);
    enforce.mockRejectedValue(
      new HttpException({ details: { code: 'SECOND_OWNER_REQUIRED' } }, 403),
    );
    svc.update.mockClear();
    await http()
      .patch(`/platform/coupons/${ID}`)
      .set('X-Approval-Token', 't')
      .send({ max_uses: 9 })
      .expect(403);
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('PATCH without a step-up token is refused; a non-UUID id is 400', async () => {
    await http().patch(`/platform/coupons/${ID}`).send({ active: false }).expect(403);
    await http()
      .patch('/platform/coupons/not-a-uuid')
      .set('X-Approval-Token', 't')
      .send({ active: false })
      .expect(400);
    expect(svc.update).not.toHaveBeenCalled();
  });

  it('PATCH passes only the four editable fields; code/percent are dropped', async () => {
    await http()
      .patch(`/platform/coupons/${ID}`)
      .set('X-Approval-Token', 't')
      .send({ active: false, code: 'HACKED', percent: 100, max_uses: 3 })
      .expect(200);
    expect(svc.update).toHaveBeenCalledWith(ID, { active: false, max_uses: 3 }, expect.anything());
  });

  it('usage with a non-UUID id is 400; a limit above 100 is 400', async () => {
    await http().get('/platform/coupons/not-a-uuid/usage').expect(400);
    await http().get(`/platform/coupons/${ID}/usage?limit=101`).expect(400);
    await http().get('/platform/coupons?limit=101').expect(400);
    await http().get('/platform/coupons?limit=100').expect(200);
  });
});
