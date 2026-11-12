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
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { SchoolOverviewController } from './school-overview.controller';
import { SchoolOverviewService } from './school-overview.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';

describe('SchoolOverviewController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { get: vi.fn() };
  const http = () => supertest(app.getHttpServer());

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.get.mockResolvedValue({ schoolId: SCHOOL });
    const mod = await Test.createTestingModule({
      controllers: [SchoolOverviewController],
      providers: [{ provide: SchoolOverviewService, useValue: svc }],
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
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  it('no usable cockpit token is 401 and nothing runs', async () => {
    authed = false;
    await http().get(`/platform/schools/${SCHOOL}/overview`).expect(401);
    expect(svc.get).not.toHaveBeenCalled();
  });

  it('a non-UUID school id is 400', async () => {
    await http().get('/platform/schools/nope/overview').expect(400);
    expect(svc.get).not.toHaveBeenCalled();
  });

  it('returns the overview with no-store', async () => {
    const res = await http().get(`/platform/schools/${SCHOOL}/overview`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(svc.get).toHaveBeenCalledWith(SCHOOL);
  });
});
