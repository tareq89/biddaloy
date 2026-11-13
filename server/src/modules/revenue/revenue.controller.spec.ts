import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  UnauthorizedException,
  ValidationPipe,
  type ExecutionContext,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { PlatformAdminGuard } from '../platform-identity/platform-admin.guard';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';

describe('RevenueController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { report: vi.fn(), csv: vi.fn() };
  const http = () => supertest(app.getHttpServer());

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.report.mockResolvedValue({ month: '2026-03' });
    svc.csv.mockResolvedValue({ month: '2026-03', body: '"a"\r\n' });
    const mod = await Test.createTestingModule({
      controllers: [RevenueController],
      providers: [{ provide: RevenueService, useValue: svc }],
    })
      // Stands for no token, a school-app token and an `imp` token: the real strategy answers 401.
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
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  it('a school token is refused and nothing runs', async () => {
    authed = false;
    await http().get('/platform/money/revenue').expect(401);
    expect(svc.report).not.toHaveBeenCalled();
  });

  it.each(['2026-13', 'x', '2026-1'])('bad month %s is 400', async (m) => {
    await http().get(`/platform/money/revenue?month=${m}`).expect(400);
    expect(svc.report).not.toHaveBeenCalled();
  });

  it.each(['101', '0', 'abc'])('limit %s is 400', async (l) => {
    await http().get(`/platform/money/revenue?limit=${l}`).expect(400);
    expect(svc.report).not.toHaveBeenCalled();
  });

  it('an unknown format is 400', async () => {
    await http().get('/platform/money/revenue?format=xml').expect(400);
  });

  it('passes month, cursor and limit through', async () => {
    await http().get('/platform/money/revenue?month=2026-03&limit=100&cursor=abc').expect(200);
    expect(svc.report).toHaveBeenCalledWith('2026-03', 'abc', 100);
  });

  it('format=csv answers text/csv', async () => {
    const res = await http().get('/platform/money/revenue?month=2026-03&format=csv').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv/);
    expect(res.headers['content-disposition']).toContain('revenue-2026-03.csv');
    expect(res.text).toBe('"a"\r\n');
  });
});
