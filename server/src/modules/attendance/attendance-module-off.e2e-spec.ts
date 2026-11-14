import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ModuleKey, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { MODULE_OFF_MESSAGE } from '../../common/filters/known-errors';
import { setModules } from '@test/helpers/modules.helper';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/** [77.2.01] Dashboard widget routes of the tagged controllers. */
const ATTENDANCE_URL = '/api/v1/dashboard/widgets/attendance-today';
const STAFF_URL = '/api/v1/dashboard/widgets/staff-today';

describe('[77.2.01] attendance + staff attendance controllers honour the module switch', () => {
  let app: INestApplication;
  let token: string;
  const get = (url: string) =>
    supertest(app.getHttpServer())
      .get(url)
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
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = res.body.access_token;
  }, 60000);

  afterAll(async () => {
    await setModules(app, SEED_TENANT_ID, { attendance: null, staffAttendance: null });
    await app.close();
  });

  async function expectOffThenOn(key: ModuleKey, url: string) {
    await setModules(app, SEED_TENANT_ID, { [key]: { on: false } });
    const off = await get(url).expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [key]: null });
    await get(url).expect(200);
  }

  it('attendance: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await expectOffThenOn(ModuleKey.attendance, ATTENDANCE_URL);
  });

  it('staffAttendance: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await expectOffThenOn(ModuleKey.staffAttendance, STAFF_URL);
  });
});
