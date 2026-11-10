import { describe, it, expect, afterEach } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  Throttle,
  ThrottlerModule,
  ThrottlerStorage,
  ThrottlerStorageService,
} from '@nestjs/throttler';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { AppThrottlerGuard, FailClosedWithoutRedis } from './app-throttler.guard';
import { buildRateLimitTracker } from './rate-limit-tracker';
import { FailOpenThrottlerStorage } from './fail-open-throttler-storage';

// Probe routes shaped like the real ones: sign-in and refresh under /auth, one ordinary route.
@Controller('auth')
class AuthProbeController {
  @Post('login')
  @FailClosedWithoutRedis()
  login() {
    return { ok: true };
  }

  @Post('refresh')
  refresh() {
    return { ok: true };
  }
}

// Checks the caller's current password outside /auth/; marked at class level.
@FailClosedWithoutRedis()
@Controller('users/me')
class ContactChangeProbeController {
  @Post('contact-change')
  request() {
    return { ok: true };
  }
}

@Controller('things')
class ThingsProbeController {
  @Get()
  list() {
    return { ok: true };
  }
}

const redisDown: ThrottlerStorage = {
  increment: () => Promise.reject(new Error('ECONNREFUSED')),
};

async function bootApp(storage: ThrottlerStorage, limit = 100): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({ throttlers: [{ name: 'default', limit, ttl: 60_000 }], storage }),
    ],
    controllers: [AuthProbeController, ContactChangeProbeController, ThingsProbeController],
    providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApiVersioning(app);
  await app.init();
  return app;
}

describe('AppThrottlerGuard (Redis down vs up)', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  describe('with the rate-limit store unreachable', () => {
    it('answers 503 on POST /auth/login (fail closed)', async () => {
      app = await bootApp(new FailOpenThrottlerStorage(redisDown));
      const res = await supertest(app.getHttpServer()).post('/api/v1/auth/login').expect(503);
      expect(res.body.message).toBe(
        'This action is temporarily unavailable. Please try again in a few minutes.',
      );
    });

    it('answers 503 on POST /users/me/contact-change (password check, fail closed)', async () => {
      app = await bootApp(new FailOpenThrottlerStorage(redisDown));
      await supertest(app.getHttpServer()).post('/api/v1/users/me/contact-change').expect(503);
    });

    it('keeps POST /auth/refresh working (fail open)', async () => {
      app = await bootApp(new FailOpenThrottlerStorage(redisDown));
      await supertest(app.getHttpServer()).post('/api/v1/auth/refresh').expect(201);
    });

    it('serves an ordinary route (fail open)', async () => {
      app = await bootApp(new FailOpenThrottlerStorage(redisDown));
      await supertest(app.getHttpServer()).get('/api/v1/things').expect(200);
    });
  });

  describe('with a working store', () => {
    // A limit of 3, not 100: 100 sequential calls can outlast the 60 s window on a loaded
    // runner, the bucket resets and the last call gets 200 (#2478).
    it('serves all three routes and still rate-limits (4th call is 429)', async () => {
      app = await bootApp(new ThrottlerStorageService(), 3);
      await supertest(app.getHttpServer()).post('/api/v1/auth/login').expect(201);
      await supertest(app.getHttpServer()).post('/api/v1/auth/refresh').expect(201);
      for (let i = 0; i < 3; i++) {
        await supertest(app.getHttpServer()).get('/api/v1/things').expect(200);
      }
      await supertest(app.getHttpServer()).get('/api/v1/things').expect(429);
    });
  });
});

// [3713] Per-host read throttle, end to end. The unit spec hands the tracker a fake request that
// already has `params.host`; this boots the real guard + real tracker behind a real Express route
// shaped like the site-read route, so it proves `req.params.host` is set when the guard runs.
// (The app's own throttler is switched off under NODE_ENV=test, so no switch is needed here.)
@Controller('public/site/by-host/:host')
@Throttle({ default: { limit: 3, ttl: 60_000 } })
class SiteReadProbeController {
  @Get('home')
  home() {
    return { ok: true };
  }
}

describe('AppThrottlerGuard per-host bucket for site reads', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  async function bootSiteApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', limit: 100, ttl: 60_000 }],
          storage: new ThrottlerStorageService(),
          getTracker: buildRateLimitTracker(new JwtService({}), { get: () => undefined }),
        }),
      ],
      controllers: [SiteReadProbeController],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
    }).compile();
    const a = moduleRef.createNestApplication();
    configureApiVersioning(a);
    await a.init();
    return a;
  }

  it('gives two hosts from one loopback address separate buckets', async () => {
    app = await bootSiteApp();
    const get = (host: string) =>
      supertest(app.getHttpServer()).get(`/api/v1/public/site/by-host/${host}/home`);
    // No X-Tenant-ID on purpose: the host is the only tenant signal on this route.
    for (let i = 0; i < 3; i++) await get('alpha.example.com').expect(200);
    await get('alpha.example.com').expect(429); // alpha's bucket is spent
    await get('beta.example.com').expect(200); // beta's is untouched
  });

  it('treats one host as one bucket whatever its letter case', async () => {
    app = await bootSiteApp();
    const get = (host: string) =>
      supertest(app.getHttpServer()).get(`/api/v1/public/site/by-host/${host}/home`);
    for (let i = 0; i < 3; i++) await get('gamma.example.com').expect(200);
    await get('GAMMA.example.com').expect(429); // same bucket as gamma: lower-casing works
    await get('delta.example.com').expect(200); // and a different host still has its own bucket
  });
});
