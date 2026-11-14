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
import { toCsvContent } from '@biddaloy/shared';
import { PlatformHomeService } from '../../platform-identity/platform-home.service';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { PlatformSmsReportController } from './platform-sms-report.controller';
import { SmsStateReportService } from './sms-state-report.service';

const BASE = '/platform/money/sms';

describe('PlatformSmsReportController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = {
    getReport: vi.fn(),
    csvRows: vi.fn(),
    toCsv: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.getReport.mockResolvedValue({ schools: [], nextCursor: null });
    svc.csvRows.mockResolvedValue([]);
    svc.toCsv.mockImplementation(() => toCsvContent([['School'], ['=cmd()']]));
    const mod = await Test.createTestingModule({
      controllers: [PlatformSmsReportController],
      providers: [{ provide: SmsStateReportService, useValue: svc }],
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
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  const http = () => supertest(app.getHttpServer());

  it('is a cockpit-owner route: no usable token (also a school-app token) is 401 and nothing runs', async () => {
    authed = false;
    await http().get(BASE).expect(401);
    await http().get(`${BASE}?format=csv`).expect(401);
    expect(svc.getReport).not.toHaveBeenCalled();
    expect(svc.csvRows).not.toHaveBeenCalled();
  });

  it('is read-only: no step-up guard, and no write verbs exist', async () => {
    await http().get(BASE).expect(200);
    await http().post(BASE).expect(404);
    await http().delete(BASE).expect(404);
  });

  it('limit above 100 is a 400; 100 is fine and is passed through with the cursor', async () => {
    await http().get(`${BASE}?limit=101`).expect(400);
    await http().get(`${BASE}?limit=100&after=abc`).expect(200);
    expect(svc.getReport).toHaveBeenCalledWith(100, 'abc');
  });

  it('format=csv sends a BOM, a header row and a defused formula cell', async () => {
    const res = await http().get(`${BASE}?format=csv`).expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    const text = res.text;
    expect(text.startsWith('﻿')).toBe(true);
    expect(text).toContain('School');
    expect(text).toContain("'=cmd()");
  });

  it('the real PlatformAdminGuard refuses a school user (not a cockpit principal) with 403', async () => {
    const mod = await Test.createTestingModule({
      controllers: [PlatformSmsReportController],
      providers: [
        { provide: SmsStateReportService, useValue: svc },
        { provide: PlatformHomeService, useValue: { id: async () => 'home' } },
      ],
    })
      .overrideGuard(AuthGuard('cockpit-jwt'))
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = { sub: 'u1', typ: 'access' };
          return true;
        },
      })
      .compile();
    const a = mod.createNestApplication();
    await a.init();
    await supertest(a.getHttpServer()).get(BASE).expect(403);
    expect(svc.getReport).not.toHaveBeenCalled();
    await a.close();
  });
});
