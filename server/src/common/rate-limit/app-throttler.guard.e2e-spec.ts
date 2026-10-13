import { describe, it, expect, afterEach } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { AppThrottlerGuard } from './app-throttler.guard';
import { FailOpenThrottlerStorage } from './fail-open-throttler-storage';

// Probe routes shaped like the real ones: sign-in and refresh under /auth, one ordinary route.
@Controller('auth')
class AuthProbeController {
  @Post('login')
  login() {
    return { ok: true };
  }

  @Post('refresh')
  refresh() {
    return { ok: true };
  }
}

// Checks the caller's current password outside /auth/.
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
      expect(res.body.message).toMatch(/temporarily unavailable/);
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
    it('serves all three routes and still rate-limits (101st call is 429)', async () => {
      app = await bootApp(new ThrottlerStorageService());
      await supertest(app.getHttpServer()).post('/api/v1/auth/login').expect(201);
      await supertest(app.getHttpServer()).post('/api/v1/auth/refresh').expect(201);
      for (let i = 0; i < 100; i++) {
        await supertest(app.getHttpServer()).get('/api/v1/things').expect(200);
      }
      await supertest(app.getHttpServer()).get('/api/v1/things').expect(429);
    });
  });
});
