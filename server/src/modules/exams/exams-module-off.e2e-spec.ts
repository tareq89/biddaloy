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

/**
 * [#3912] One case per module key this ticket tags. The full table-driven spec is
 * the wave-2 close (77.2.10). Each URL is a GET route of a tagged controller.
 */
describe('[#3912] exams + seat plans + evaluations controllers honour the module switch', () => {
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
    await setModules(app, SEED_TENANT_ID, { exams: null, seatPlans: null, evaluations: null });
    await app.close();
  });

  it('exams: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.exams]: { on: false } });
    const off = await get('/api/v1/dashboard/widgets/mark-entry-progress').expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [ModuleKey.exams]: null });
    await get('/api/v1/dashboard/widgets/mark-entry-progress').expect(200);
  });

  it('seatPlans: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.seatPlans]: { on: false } });
    const off = await get('/api/v1/dashboard/widgets/seat-plan-status').expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [ModuleKey.seatPlans]: null });
    await get('/api/v1/dashboard/widgets/seat-plan-status').expect(200);
  });

  it('evaluations: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.evaluations]: { on: false } });
    const off = await get('/api/v1/acr/criteria').expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [ModuleKey.evaluations]: null });
    await get('/api/v1/acr/criteria').expect(200);
  });

});
