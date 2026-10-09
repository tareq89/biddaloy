import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * Regression for a routing bug: `RoutineSlotsController`'s `@Get(':id')`
 * is a catch-all under `routines/`. When it was registered before
 * `ResolveRoutineController`/`SubstitutionsController` in
 * `routines.module.ts`, Nest matched `/routines/resolve` and
 * `/routines/substitutions` against `:id` first, so the real handlers
 * never ran — the guard chain rejected both with 401 instead of the
 * expected 200. These two routes never got an HTTP-level e2e test
 * before, only mocked-response unit/integration tests, so nothing
 * caught it.
 */
const API = '/api/v1';

describe('Routines routing (routes/:id must not shadow literal routes)', () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = res.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /routines/resolve is not swallowed by /routines/:id', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/routines/resolve`)
      .query({ section_id: SEED_SECTION_1_ID, from: '2026-01-01', to: '2026-01-07' })
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /routines/substitutions is not swallowed by /routines/:id', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/routines/substitutions`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
