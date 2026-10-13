import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * [75.13-b] A malformed UUID path param is answered by `ParseUUIDPipe` with
 * 400, instead of reaching Postgres and coming back as a 500 (or, for the
 * workbook error CSV, a misleading 404). One route per controller.
 */
describe('ParseUUIDPipe on academics, attendance and calendar params (75.13-b)', () => {
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

  const asAdminPost = (path: string) =>
    supertest(app.getHttpServer())
      .post(`${API}${path}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .send({});

  it('GET /academic-years/not-a-uuid is 400, not 500', async () => {
    await asAdmin('/academic-years/not-a-uuid').expect(400);
  });

  it('POST /attendance/sections/not-a-uuid/absence-notice/preview is 400', async () => {
    await asAdminPost('/attendance/sections/not-a-uuid/absence-notice/preview').expect(400);
  });

  it('GET /attendance/sections/not-a-uuid/summary is 400', async () => {
    await asAdmin('/attendance/sections/not-a-uuid/summary').expect(400);
  });

  it('GET /attendance/sections/not-a-uuid/register-matrix is 400', async () => {
    await asAdmin('/attendance/sections/not-a-uuid/register-matrix').expect(400);
  });

  it('POST /attendance/devices/not-a-uuid/rotate is 400', async () => {
    await asAdminPost('/attendance/devices/not-a-uuid/rotate').expect(400);
  });

  it('GET /calendar/events/not-a-uuid is 400', async () => {
    await asAdmin('/calendar/events/not-a-uuid').expect(400);
  });

  it('a valid but unknown UUID still reaches the handler and gets 404', async () => {
    await asAdmin(`/calendar/events/${RANDOM_VALID_UUID}`).expect(404);
    await asAdmin(`/academic-years/${RANDOM_VALID_UUID}`).expect(404);
  });

  it('platform holiday-sets: ADMIN gets 403 from the guard, before the pipe', async () => {
    // SUPER_ADMIN-only route; its pipe is covered by param-uuid-coverage.spec.ts.
    await asAdmin('/platform/holiday-sets/not-a-uuid').expect(403);
  });

  it('no token still gets 401, the auth guard runs before the pipe', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/academic-years/not-a-uuid`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .expect(401);
  });
});
