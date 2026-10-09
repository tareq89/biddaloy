import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL } from '@test/constants';
import { TenantStatusService } from '../tenant-status.service';

/**
 * [13.2.3] A request into a school whose trial ended is refused by the real
 * cache -> DB -> ContextGuard path, and says why.
 */
describe('Trial-expired school (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let status: TenantStatusService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    status = app.get(TenantStatusService);
  }, 60000);

  afterAll(async () => {
    await ds.query(`UPDATE schools SET status = 'ACTIVE', status_reason = NULL WHERE id = $1`, [
      SEED_TENANT_ID,
    ]);
    await status.invalidate(SEED_TENANT_ID);
    await app.close();
  });

  it('403s with TENANT_SUSPENDED and reason TRIAL_EXPIRED, and works again once reactivated', async () => {
    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: 'password123' })
      .expect(200);
    const token = login.body.access_token;
    const get = () =>
      supertest(app.getHttpServer())
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', SEED_TENANT_ID);

    await get().expect(200); // also warms the status cache with ACTIVE

    await ds.query(
      `UPDATE schools SET status = 'SUSPENDED', status_reason = 'TRIAL_EXPIRED' WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    await status.invalidate(SEED_TENANT_ID);

    const res = await get().expect(403);
    expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    expect(res.body.details ?? res.body.error?.details ?? res.body.message?.details).toMatchObject({
      code: 'TENANT_SUSPENDED',
      reason: 'TRIAL_EXPIRED',
    });

    await ds.query(`UPDATE schools SET status = 'ACTIVE', status_reason = NULL WHERE id = $1`, [
      SEED_TENANT_ID,
    ]);
    await status.invalidate(SEED_TENANT_ID);
    await get().expect(200);
  });
});
