import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { configureBodyParser } from '../../body-parser';
import { AllExceptionsFilter } from './http-exception.filter';
import { SEED_TENANT_ID } from '@test/constants';

/**
 * [2634] Errors raised before a controller runs (body-parser) and library
 * errors (Postgres unique violation, multer) answer a fixed 4xx, never a 500,
 * and never echo what was sent. #2612 and #2616 append their cases here.
 */
const API = '/api/v1';

describe('known-errors (e2e)', () => {
  let app: NestExpressApplication;
  const login = () =>
    supertest(app.getHttpServer()).post(`${API}/auth/login`).set('X-Tenant-ID', SEED_TENANT_ID);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApiVersioning(app);
    configureBodyParser(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('body-parser errors', () => {
    it('answers 413 for a body over the JSON limit', async () => {
      const big = JSON.stringify({ email: 'a'.repeat(1_500_000) });
      const res = await login().set('Content-Type', 'application/json').send(big);
      expect(res.status).toBe(413);
      expect(res.body.message).toBe('Request body too large');
    });

    it('answers 415 for an unsupported charset and does not echo it', async () => {
      const res = await login()
        .set('Content-Type', 'application/json; charset=bogus')
        .send('{"a":1}');
      expect(res.status).toBe(415);
      expect(JSON.stringify(res.body)).not.toMatch(/bogus/i);
    });

    it('answers 400 for a content-encoding gzip body that is not gzip', async () => {
      const res = await login()
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send('plain text, not gzip');
      expect(res.status).toBe(400);
    });

    it('answers 400 for malformed JSON', async () => {
      const res = await login().set('Content-Type', 'application/json').send('{"a":');
      expect(res.status).toBe(400);
    });
  });
});
