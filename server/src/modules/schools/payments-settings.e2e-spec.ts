import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_SETTINGS_SCHEMA_VERSION } from './dto/tenant-settings.dto';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

const API = '/api/v1';
const SECRET = 'bk-plain-secret-value-3962';
const BODY = {
  version: TENANT_SETTINGS_SCHEMA_VERSION,
  payments: {
    proofEnabled: true,
    proofMethods: [{ method: 'BKASH', instructions: 'Send to 01XXXXXXXXX' }],
    bkash: {
      environment: 'SANDBOX',
      appKey: SECRET,
      appSecret: SECRET,
      username: SECRET,
      password: SECRET,
    },
  },
};

/** [3.1.03] `settings.payments` through the settings route: masking, D13 gate, X-Tenant-ID. */
describe('Payments settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const patch = (body: object, tenant: string | null = SEED_TENANT_ID, school = SEED_TENANT_ID) => {
    const req = supertest(app.getHttpServer())
      .patch(`${API}/schools/${school}/settings`)
      .set('Authorization', `Bearer ${token}`);
    return (tenant ? req.set('X-Tenant-ID', tenant) : req).send(body);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);
    token = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60000);

  beforeEach(async () => {
    await dataSource.query(`UPDATE schools SET settings = '{}'::jsonb WHERE id = $1`, [
      SEED_TENANT_ID,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('masks the four secrets in the response and encrypts them at rest', async () => {
    const res = await patch(BODY).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    expect(res.body.payments.bkash.appKey).toMatchObject({ configured: true });
    const [{ s }] = await dataSource.query(
      `SELECT settings::text AS s FROM schools WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    expect(s).not.toContain(SECRET);
  });

  it('refuses online-on without a passing test (400, fixed sentence, no echo)', async () => {
    await patch(BODY).expect(200);
    const res = await patch({
      version: TENANT_SETTINGS_SCHEMA_VERSION,
      payments: { onlineEnabled: true },
    }).expect(400);
    expect(res.body.message).toBe('Test the bKash connection before turning online payments on.');
  });

  it('missing X-Tenant-ID is 401; non-UUID school id is 400', async () => {
    await patch(BODY, null).expect(401);
    await patch(BODY, SEED_TENANT_ID, 'not-a-uuid').expect(400);
  });

  it('an invalid X-Tenant-ID is refused and stores nothing', async () => {
    const res = await patch(BODY, 'not-a-uuid');
    expect([400, 401, 403]).toContain(res.status);
    const [{ p }] = await dataSource.query(
      `SELECT settings->'payments' AS p FROM schools WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    expect(p).toBeNull();
  });
});
