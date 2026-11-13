import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ModuleKey, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { setModules } from '@test/helpers/modules.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { MODULE_OFF_MESSAGE } from '../../common/filters/known-errors';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * [Epic 77, #3911] One case per module key tagged on this ticket: module off -> 403 with the
 * fixed sentence for ADMIN; on -> 200. The full table-driven spec is 77.2.10.
 */

const API = '/api/v1';

const CASES: { key: ModuleKey; route: string }[] = [
  { key: ModuleKey.fees, route: `${API}/fees/schedules` },
  { key: ModuleKey.fines, route: `${API}/fees/fines` },
  { key: ModuleKey.messaging, route: `${API}/communications/logs` },
];

describe('[Epic 77] fees / fines / messaging controllers honour the module switch', () => {
  let app: INestApplication;
  let token: string;

  const call = (route: string) =>
    supertest(app.getHttpServer())
      .get(route)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', UserRole.ADMIN);

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
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await setModules(app, SEED_TENANT_ID, { fees: null, fines: null, messaging: null });
    await app.close();
  });

  for (const { key, route } of CASES) {
    it(`${key}: off -> 403 fixed text, on -> 200`, async () => {
      await setModules(app, SEED_TENANT_ID, { [key]: { on: false } });
      const off = await call(route).expect(403);
      expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

      await setModules(app, SEED_TENANT_ID, { [key]: { on: true } });
      await call(route).expect(200);
    });
  }
});
