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
import { SchoolRenameController } from './school-rename.controller';
import { SchoolRenameService } from './school-rename.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const URL = `/platform/schools/${SCHOOL}/name`;
const OK = { name: 'New Name', reason: 'typo' };

describe('SchoolRenameController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { rename: vi.fn() };
  const http = () => supertest(app.getHttpServer());
  const withToken = (r: supertest.Test) => r.set('x-approval-token', 't');

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.rename.mockResolvedValue({ name: 'New Name', name_bn: null, changed: true });
    const approvalStub: CanActivate = {
      canActivate: (c: ExecutionContext) => {
        if (!c.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_SCHOOL_CONTROL);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [SchoolRenameController],
      providers: [{ provide: SchoolRenameService, useValue: svc }],
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

  it('no usable cockpit token is 401 and nothing runs', async () => {
    authed = false;
    await withToken(http().patch(URL)).send(OK).expect(401);
    expect(svc.rename).not.toHaveBeenCalled();
  });

  it('without a step-up token the route refuses and nothing runs', async () => {
    const res = await http().patch(URL).send(OK);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).not.toBe(200);
    expect(svc.rename).not.toHaveBeenCalled();
  });

  it('a non-UUID school id is 400', async () => {
    await withToken(http().patch('/platform/schools/nope/name')).send(OK).expect(400);
    expect(svc.rename).not.toHaveBeenCalled();
  });

  it('bad bodies are 400: no reason, blank name, null name, 201-char name', async () => {
    const bad = [
      { name: 'x' },
      { name: '   ', reason: 'r' },
      { name: null, reason: 'r' },
      { name: 'a'.repeat(201), reason: 'r' },
      { name: 'x', reason: '' },
    ];
    for (const body of bad) await withToken(http().patch(URL)).send(body).expect(400);
    expect(svc.rename).not.toHaveBeenCalled();
  });

  it('a valid rename passes trimmed body, owner and school', async () => {
    await withToken(http().patch(URL)).send({ name: '  New Name ', reason: ' typo ' }).expect(200);
    expect(svc.rename).toHaveBeenCalledWith(
      SCHOOL,
      expect.objectContaining({ name: 'New Name', reason: 'typo' }),
      'owner-1',
      expect.any(Object),
    );
  });
});
