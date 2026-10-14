import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * [75.13] A malformed UUID path param is answered by `ParseUUIDPipe` with
 * 400, instead of reaching Postgres and coming back as a 500 (or, for the
 * workbook error CSV, a misleading 404). One route per controller.
 */
describe('ParseUUIDPipe on path params (75.13)', () => {
  let app: INestApplication;
  let adminToken: string;
  const API = '/api/v1';
  const RANDOM_VALID_UUID = '00000000-0000-4000-8000-0000000fffff';

  const asAdmin = (path: string) =>
    supertest(app.getHttpServer())
      .get(`${API}${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('GET /students/not-a-uuid is 400, not 500', async () => {
    await asAdmin('/students/not-a-uuid').expect(400);
  });

  it('GET /enrollments/student/not-a-uuid is 400', async () => {
    await asAdmin('/enrollments/student/not-a-uuid').expect(400);
  });

  it('GET /fee-structures/not-a-uuid is 400', async () => {
    await asAdmin('/fee-structures/not-a-uuid').expect(400);
  });

  it('GET /students/not-a-uuid/wallet is 400', async () => {
    await asAdmin('/students/not-a-uuid/wallet').expect(400);
  });

  it('GET /homework-assignments/not-a-uuid/submissions is 400', async () => {
    await asAdmin('/homework-assignments/not-a-uuid/submissions').expect(400);
  });

  it('GET /users/not-a-uuid is 400', async () => {
    await asAdmin('/users/not-a-uuid').expect(400);
  });

  it('GET /audit-logs/entity/Student/not-a-uuid is 400', async () => {
    await asAdmin('/audit-logs/entity/Student/not-a-uuid').expect(400);
  });

  it('GET /backup/validate/not-a-uuid/errors.csv is 400 (was a 404 from the empty Redis lookup)', async () => {
    await asAdmin('/backup/validate/not-a-uuid/errors.csv').expect(400);
  });

  it('a valid but unknown UUID still reaches the handler and gets 404', async () => {
    await asAdmin(`/fee-structures/${RANDOM_VALID_UUID}`).expect(404);
    await asAdmin(`/students/${RANDOM_VALID_UUID}`).expect(404);
  });

  it('students/mine is not captured by students/:id (route order unchanged)', async () => {
    // ADMIN is not allowed on `mine` (PARENT/STUDENT only): 403, never the 400 from the pipe.
    const res = await asAdmin('/students/mine');
    expect(res.status).not.toBe(400);
  });

  it('no token still gets 401, the auth guard runs before the pipe', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/students/not-a-uuid`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });
});
