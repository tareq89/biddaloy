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
import { PlatformSmsStockController } from './platform-sms-stock.controller';
import { ProviderBalanceReader } from './provider-balance.reader';
import { SmsStockService } from './sms-stock.service';

const ID = '11111111-1111-4111-8111-111111111111';
const BASE = '/platform/sms-stock';

describe('PlatformSmsStockController', () => {
  let app: INestApplication;
  let authed: boolean;
  const stock = {
    list: vi.fn(),
    record: vi.fn(),
    remove: vi.fn(),
    recordBalance: vi.fn(),
  };
  const reader = { read: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    stock.list.mockResolvedValue({ items: [], nextCursor: null });
    stock.record.mockResolvedValue({ id: ID });
    stock.recordBalance.mockResolvedValue({ sms: 5, asOf: 'x' });
    reader.read.mockResolvedValue({ sms: null, source: 'UNKNOWN', asOf: null, stale: false });
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        if (!ctx.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_SMS_STOCK);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [PlatformSmsStockController],
      providers: [
        { provide: SmsStockService, useValue: stock },
        { provide: ProviderBalanceReader, useValue: reader },
      ],
    })
      // The real cockpit-jwt strategy answers 401 for no token and for a school-app token
      // (aud biddaloy:access); the stub stands for both.
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
  const entry = { boughtOn: '2026-11-01', smsCount: 1000, costTaka: 12.5 };

  it('no usable cockpit token is 401 on every route and nothing runs', async () => {
    authed = false;
    await http().get(BASE).expect(401);
    await http().post(BASE).send(entry).expect(401);
    await http().get(`${BASE}/balance`).expect(401);
    await http().post(`${BASE}/balance`).send({ smsBalance: 1 }).expect(401);
    await http()
      .delete(`${BASE}/${ID}`)
      .set('X-Approval-Token', 't')
      .send({ reason: 'mistake' })
      .expect(401);
    expect(stock.record).not.toHaveBeenCalled();
    expect(stock.remove).not.toHaveBeenCalled();
  });

  it('record passes the owner id and needs no step-up', async () => {
    await http().post(BASE).send(entry).expect(201);
    expect(stock.record).toHaveBeenCalledWith(
      entry,
      expect.objectContaining({ userId: 'owner-1' }),
    );
  });

  it('record rejects bad bodies (count, cost, decimals, overlong note)', async () => {
    const post = (b: object) =>
      http()
        .post(BASE)
        .send({ ...entry, ...b });
    await post({ smsCount: 0 }).expect(400);
    await post({ smsCount: 100_000_001 }).expect(400);
    await post({ costTaka: 100_000_000 }).expect(400);
    await post({ costTaka: -1 }).expect(400);
    await post({ costTaka: 1.234 }).expect(400);
    await post({ note: 'x'.repeat(501) }).expect(400);
    expect(stock.record).not.toHaveBeenCalled();
  });

  it('list caps limit at 100', async () => {
    await http().get(`${BASE}?limit=101`).expect(400);
    await http().get(`${BASE}?limit=100`).expect(200);
  });

  it('balance bounds are 0 to 1,000,000,000', async () => {
    await http().post(`${BASE}/balance`).send({ smsBalance: -1 }).expect(400);
    await http().post(`${BASE}/balance`).send({ smsBalance: 1_000_000_001 }).expect(400);
    await http().post(`${BASE}/balance`).send({ smsBalance: 0 }).expect(201);
  });

  it('GET balance is not read as an id', async () => {
    const res = await http().get(`${BASE}/balance`).expect(200);
    expect(res.body.source).toBe('UNKNOWN');
  });

  it('delete without the step-up proof is 403 APPROVAL_REQUIRED and deletes nothing', async () => {
    const res = await http().delete(`${BASE}/${ID}`).send({ reason: 'entered twice' }).expect(403);
    expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUIRED');
    expect(stock.remove).not.toHaveBeenCalled();
  });

  it('a non-UUID id is 400', async () => {
    await http()
      .delete(`${BASE}/nope`)
      .set('X-Approval-Token', 't')
      .send({ reason: 'entered twice' })
      .expect(400);
    expect(stock.remove).not.toHaveBeenCalled();
  });

  it('delete requires a reason of 5 to 490 chars', async () => {
    const del = (b: object) => http().delete(`${BASE}/${ID}`).set('X-Approval-Token', 't').send(b);
    await del({}).expect(400);
    await del({ reason: 'no' }).expect(400);
    await del({ reason: 'x'.repeat(491) }).expect(400);
    expect(stock.remove).not.toHaveBeenCalled();
  });

  it('delete with proof and reason passes ids through', async () => {
    await http()
      .delete(`${BASE}/${ID}`)
      .set('X-Approval-Token', 't')
      .send({ reason: 'entered twice' })
      .expect(204);
    expect(stock.remove).toHaveBeenCalledWith(
      ID,
      'entered twice',
      expect.objectContaining({ userId: 'owner-1' }),
    );
  });
});
