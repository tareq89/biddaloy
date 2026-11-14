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
 * [77.2.05] One case per module key this ticket tags (programs, admission, applications), plus the
 * public admission slug route. The full table-driven spec is the wave-2 close (77.2.10).
 */
describe('[77.2.05] programs, admission and applications controllers honour the module switch', () => {
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
    await setModules(app, SEED_TENANT_ID, { programs: null, admission: null, applications: null });
    await app.close();
  });

  it('programs: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.programs]: { on: false } });
    const off = await get('/api/v1/programs').expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [ModuleKey.programs]: null });
    await get('/api/v1/programs').expect(200);
  });

  it('admission: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.admission]: { on: false } });
    const off = await get('/api/v1/admission-intakes').expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [ModuleKey.admission]: null });
    await get('/api/v1/admission-intakes').expect(200);
  });

  it('applications: off -> 403 fixed text for ADMIN, on -> 200', async () => {
    await setModules(app, SEED_TENANT_ID, { [ModuleKey.applications]: { on: false } });
    const off = await get('/api/v1/applications').expect(403);
    expect(off.body.message).toBe(MODULE_OFF_MESSAGE);

    await setModules(app, SEED_TENANT_ID, { [ModuleKey.applications]: null });
    await get('/api/v1/applications').expect(200);
  });

  it('public admission: off -> the existing 404, on -> 200', async () => {
    const url = '/api/v1/public/admission/test-school';
    await setModules(app, SEED_TENANT_ID, { admission: { on: false } });
    const off = await supertest(app.getHttpServer()).get(url).expect(404);
    expect(off.body.message).toBe('School not found');

    await setModules(app, SEED_TENANT_ID, { admission: null });
    await supertest(app.getHttpServer()).get(url).expect(200);
  });
});
