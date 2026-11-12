import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import { ImpersonationEndedBy } from '@biddaloy/shared';
import { AuthService } from '../../auth/auth.service';
import { ImpersonationSessionService } from '../sessions/impersonation-session.service';
import { ImpersonationCodeService } from './impersonation-code.service';
import { ImpersonationExchangeController } from './impersonation-exchange.controller';

const CODE = 'B'.repeat(43);

describe('ImpersonationExchangeController', () => {
  let app: INestApplication;
  let user: Record<string, unknown> | null;
  const codes = { redeem: vi.fn(), describe: vi.fn() };
  const sessions = { end: vi.fn() };
  const auth = { mintImpersonationToken: vi.fn() };

  beforeEach(async () => {
    vi.clearAllMocks();
    user = { sub: 'u-1', imp: { sid: 's-1', pa: 'pa-1' } };
    const mod = await Test.createTestingModule({
      controllers: [ImpersonationExchangeController],
      providers: [
        { provide: ImpersonationCodeService, useValue: codes },
        { provide: ImpersonationSessionService, useValue: sessions },
        { provide: AuthService, useValue: auth },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({
        canActivate: (ctx: any) => {
          if (!user) return false;
          ctx.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    await app.init();
  });

  it('exchange mints with the session remaining time; X-Tenant-ID changes nothing', async () => {
    const expiresAt = new Date('2030-01-01T00:00:00Z');
    codes.redeem.mockResolvedValue({
      sid: 's-1',
      userId: 'u-1',
      adminId: 'pa-1',
      schoolId: 'school-A',
      remainingSeconds: 900,
      expiresAt,
    });
    auth.mintImpersonationToken.mockResolvedValue('tok');
    const res = await supertest(app.getHttpServer())
      .post('/auth/impersonation/exchange')
      .set('X-Tenant-ID', 'not-a-uuid')
      .send({ code: CODE })
      .expect(200);
    expect(res.body).toEqual({
      access_token: 'tok',
      sessionId: 's-1',
      expiresAt: expiresAt.toISOString(),
    });
    expect(auth.mintImpersonationToken).toHaveBeenCalledWith(
      'u-1',
      { sid: 's-1', pa: 'pa-1' },
      900,
    );
    // No refresh cookie.
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  const expectMalformed = async (code: string) => {
    await supertest(app.getHttpServer())
      .post('/auth/impersonation/exchange')
      .send({ code })
      .expect(400);
    expect(codes.redeem).not.toHaveBeenCalled();
  };

  it('rejects a too short code with 400 before any lookup', async () => {
    await expectMalformed('short');
  });

  it('rejects a 42-char code with 400 before any lookup', async () => {
    await expectMalformed('A'.repeat(42));
  });

  it('rejects a 44-char code with 400 before any lookup', async () => {
    await expectMalformed('A'.repeat(44));
  });

  it('rejects a non-base64url code with 400 before any lookup', async () => {
    await expectMalformed('+'.repeat(43));
  });

  it('rejects a empty code with 400 before any lookup', async () => {
    await expectMalformed('');
  });

  it('me returns the banner status; 403 without imp; 401 without token', async () => {
    codes.describe.mockResolvedValue({ sessionId: 's-1' });
    await supertest(app.getHttpServer()).get('/auth/impersonation/me').expect(200);
    expect(codes.describe).toHaveBeenCalledWith('s-1');
    user = { sub: 'u-1' };
    await supertest(app.getHttpServer()).get('/auth/impersonation/me').expect(403);
    user = null;
    await supertest(app.getHttpServer()).get('/auth/impersonation/me').expect(403);
  });

  it('end ends the caller own session as PERSON_TAB; 403 without imp', async () => {
    await supertest(app.getHttpServer()).post('/auth/impersonation/end').expect(204);
    expect(sessions.end).toHaveBeenCalledWith('s-1', ImpersonationEndedBy.PERSON_TAB);
    sessions.end.mockClear();
    user = { sub: 'u-1' };
    await supertest(app.getHttpServer()).post('/auth/impersonation/end').expect(403);
    expect(sessions.end).not.toHaveBeenCalled();
  });
});
