import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { PlatformAdminGuard } from '../../platform-identity/platform-admin.guard';
import { LoginAsCandidatesController } from './login-as-candidates.controller';
import { LoginAsCandidatesService } from './login-as-candidates.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const URL = `/platform/schools/${SCHOOL}/login-as/candidates`;

describe('LoginAsCandidatesController', () => {
  let app: INestApplication;
  let authed: boolean;
  const service = { list: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    service.list.mockResolvedValue({ candidates: [], noActiveAdmin: false });
    const mod = await Test.createTestingModule({
      controllers: [LoginAsCandidatesController],
      providers: [{ provide: LoginAsCandidatesService, useValue: service }],
    })
      // The real cockpit-jwt strategy rejects school-app and imp tokens (wrong audience) with 401;
      // here "authed = false" stands for that rejection.
      .overrideGuard(AuthGuard('cockpit-jwt'))
      .useValue({
        canActivate: () => {
          if (!authed) throw new UnauthorizedException();
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

  it('no usable token (none, imp or school-app) is 401 and the service is not called', async () => {
    authed = false;
    await supertest(app.getHttpServer()).get(`${URL}?role=ADMIN`).expect(401);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('passes school, role, q and limit to the service; a stray X-Tenant-ID changes nothing', async () => {
    await supertest(app.getHttpServer())
      .get(`${URL}?role=TEACHER&q=ab&limit=10`)
      .set('X-Tenant-ID', 'not-a-uuid')
      .expect(200);
    expect(service.list).toHaveBeenCalledWith(SCHOOL, 'TEACHER', 'ab', 10);
  });

  it('defaults the limit to 50', async () => {
    await supertest(app.getHttpServer()).get(`${URL}?role=ADMIN`).expect(200);
    expect(service.list).toHaveBeenCalledWith(SCHOOL, 'ADMIN', undefined, 50);
  });

  it('limit 101, SUPER_ADMIN role, missing role and non-UUID id are 400', async () => {
    const http = supertest(app.getHttpServer());
    await http.get(`${URL}?role=ADMIN&limit=101`).expect(400);
    await http.get(`${URL}?role=SUPER_ADMIN`).expect(400);
    await http.get(URL).expect(400);
    await http.get('/platform/schools/nope/login-as/candidates?role=ADMIN').expect(400);
    await http.get(`${URL}?role=ADMIN&q=${'x'.repeat(101)}`).expect(400);
    expect(service.list).not.toHaveBeenCalled();
  });
});
