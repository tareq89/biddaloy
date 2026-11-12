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
import { SchoolArchiveController } from './school-archive.controller';
import { SchoolArchiveService } from './school-archive.service';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const BASE = `/platform/schools/${SCHOOL}/archive`;

describe('SchoolArchiveController', () => {
  let app: INestApplication;
  let authed: boolean;
  const svc = { startExport: vi.fn(), getExport: vi.fn(), download: vi.fn(), archive: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    authed = true;
    svc.startExport.mockResolvedValue({ jobId: JOB });
    svc.getExport.mockResolvedValue({ id: JOB, status: 'DONE' });
    svc.download.mockResolvedValue({
      body: Buffer.from('xlsx'),
      filename: 'a.xlsx',
      sizeBytes: '4',
    });
    svc.archive.mockResolvedValue({ id: SCHOOL, status: 'SUSPENDED', exportJobId: JOB });
    const approvalStub: CanActivate = {
      canActivate: (ctx: ExecutionContext) => {
        if (!ctx.switchToHttp().getRequest().headers['x-approval-token'])
          throw new ApprovalRequiredException(ApprovalScope.PLATFORM_SCHOOL_CONTROL);
        return true;
      },
    };
    const mod = await Test.createTestingModule({
      controllers: [SchoolArchiveController],
      providers: [{ provide: SchoolArchiveService, useValue: svc }],
    })
      // The real cockpit-jwt strategy answers 401 for no token, a school-app token
      // (aud biddaloy:access) and an `imp` token; the stub stands for all three.
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
  const body = { exportJobId: JOB, reason: 'School closed' };

  it('no usable cockpit token is 401 on every route and nothing runs', async () => {
    authed = false;
    await http().post(`${BASE}/export`).expect(401);
    await http().get(`${BASE}/export/${JOB}`).expect(401);
    await http().get(`${BASE}/export/${JOB}/download`).expect(401);
    await http().post(BASE).set('X-Approval-Token', 't').send(body).expect(401);
    expect(svc.startExport).not.toHaveBeenCalled();
    expect(svc.archive).not.toHaveBeenCalled();
  });

  it('a non-UUID school or job id is 400', async () => {
    await http().post('/platform/schools/nope/archive/export').expect(400);
    await http().get(`${BASE}/export/nope`).expect(400);
    await http().get(`${BASE}/export/nope/download`).expect(400);
    await http()
      .post('/platform/schools/nope/archive')
      .set('X-Approval-Token', 't')
      .send(body)
      .expect(400);
    expect(svc.getExport).not.toHaveBeenCalled();
  });

  it('start export answers 202 with the job id', async () => {
    const res = await http().post(`${BASE}/export`).expect(202);
    expect(res.body).toEqual({ jobId: JOB });
    expect(svc.startExport).toHaveBeenCalledWith(SCHOOL);
  });

  it('status is no-store and passes both ids', async () => {
    const res = await http().get(`${BASE}/export/${JOB}`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(svc.getExport).toHaveBeenCalledWith(SCHOOL, JOB);
  });

  it('download streams the file with attachment and no-store headers', async () => {
    const res = await http().get(`${BASE}/export/${JOB}/download`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBe('attachment; filename="a.xlsx"');
    expect(svc.download).toHaveBeenCalledWith(SCHOOL, JOB);
  });

  it('archive without X-Approval-Token is 403 APPROVAL_REQUIRED', async () => {
    const res = await http().post(BASE).send(body).expect(403);
    expect(JSON.stringify(res.body)).toContain('APPROVAL_REQUIRED');
    expect(svc.archive).not.toHaveBeenCalled();
  });

  it('archive rejects a bad body (non-UUID job, short or overlong reason)', async () => {
    const post = (b: object) => http().post(BASE).set('X-Approval-Token', 't').send(b);
    await post({ exportJobId: 'x', reason: 'School closed' }).expect(400);
    await post({ exportJobId: JOB, reason: 'no' }).expect(400);
    await post({ exportJobId: JOB, reason: 'x'.repeat(491) }).expect(400);
    expect(svc.archive).not.toHaveBeenCalled();
  });

  it('archive passes the owner id from the token', async () => {
    await http().post(BASE).set('X-Approval-Token', 't').send(body).expect(200);
    expect(svc.archive).toHaveBeenCalledWith(SCHOOL, body, 'owner-1', expect.any(Object));
  });
});
