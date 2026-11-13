import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_SETTINGS_SCHEMA_VERSION } from './dto/tenant-settings.dto';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

const API = '/api/v1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c7701';
const DENIED_ROLES = [UserRole.ACCOUNTANT, UserRole.TEACHER, UserRole.PARENT];

/** [77.1.02] `settings.modules` / `settings.labels` through `PATCH/GET /schools/:id/settings`. */
describe('Modules and labels settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;
  const settingsUrl = (id: string) => `${API}/schools/${id}/settings`;

  const patch = (
    body: Record<string, unknown>,
    opts: { tenant?: string; role?: UserRole; schoolId?: string } = {},
  ) => {
    const tenant = opts.tenant ?? TENANT_ID;
    const req = supertest(app.getHttpServer())
      .patch(settingsUrl(opts.schoolId ?? tenant))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);
    if (opts.role) req.set('X-Role', opts.role);
    return req.send({ version: TENANT_SETTINGS_SCHEMA_VERSION, ...body });
  };
  const get = (tenant = TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(settingsUrl(tenant))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);

  const clearStored = () =>
    dataSource.query(
      `UPDATE schools SET settings = settings - 'modules' - 'labels' WHERE id = ANY($1)`,
      [[TENANT_ID, OTHER_TENANT_ID]],
    );
  const auditRows = (action: string) =>
    dataSource.query(
      `SELECT old_values, new_values FROM audit_logs
       WHERE action = $1 AND tenant_id = $2 AND entity_id = $2 ORDER BY created_at DESC`,
      [action, TENANT_ID],
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Modules School', 'other-modules-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    // Same user holds the probed roles on the seed tenant so `X-Role` can test the matrix.
    for (const role of DENIED_ROLES) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, TENANT_ID, role],
      );
    }
    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
    await clearStored();
  }, 60000);

  afterAll(async () => {
    await clearStored();
    await dataSource.query(
      `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`,
      [SEED_ADMIN_USER_ID, TENANT_ID, DENIED_ROLES],
    );
    await app.close();
  });

  it('defaults both blocks to empty objects', async () => {
    const res = await get().expect(200);
    expect(res.body.modules).toEqual({});
    expect(res.body.labels).toEqual({});
  });

  it('ADMIN PATCH is visible on an immediate read-back (cache invalidated) and audited', async () => {
    const words = { class: { en: { one: 'Course', other: 'Courses' }, bn: 'কোর্স' } };
    const res = await patch({
      modules: { fees: { on: false }, exams: { offForRoles: ['TEACHER'] } },
      labels: words,
    }).expect(200);
    expect(res.body.modules.fees).toEqual({ on: false });
    // Read straight after the write: a stale settings cache would still show `{}`.
    const read = (await get().expect(200)).body;
    expect(read.modules).toEqual({ fees: { on: false }, exams: { offForRoles: ['TEACHER'] } });
    expect(read.labels).toEqual(words);

    const [mod] = await auditRows('MODULES_UPDATED');
    expect(mod.old_values).toEqual({});
    expect(mod.new_values).toEqual(read.modules);
    const [lab] = await auditRows('WORDS_UPDATED');
    expect(lab.old_values).toEqual({});
    expect(lab.new_values).toEqual(words);
  });

  it('deep merges per key and null removes a key, auditing old/new of that block', async () => {
    await patch({ modules: { fees: null, fines: { on: false } } }).expect(200);
    const read = (await get().expect(200)).body;
    expect(read.modules).toEqual({ exams: { offForRoles: ['TEACHER'] }, fines: { on: false } });
    const [mod] = await auditRows('MODULES_UPDATED');
    expect(mod.old_values.fees).toEqual({ on: false });
    expect(mod.new_values.fees).toBeUndefined();
  });

  it('writes no audit row when nothing changed', async () => {
    const before = (await auditRows('MODULES_UPDATED')).length;
    await patch({ modules: { fines: { on: false } } }).expect(200);
    expect((await auditRows('MODULES_UPDATED')).length).toBe(before);
  });

  it('a mixed patch audits modules and the other block separately, with no modules key in SETTINGS_CHANGE', async () => {
    await patch({
      modules: { fines: { on: true } },
      attention: { attendanceGraceMinutes: 7 },
    }).expect(200);
    const read = (await get().expect(200)).body;
    expect(read.modules.fines).toEqual({ on: true });
    expect(read.attention.attendanceGraceMinutes).toBe(7);
    const [mod] = await auditRows('MODULES_UPDATED');
    expect(mod.new_values.fines).toEqual({ on: true });
    const [chg] = await auditRows('SETTINGS_CHANGE');
    expect(JSON.stringify(chg.new_values)).not.toContain('modules');
  });

  it('rejects bad input with 400 and leaves stored blocks unchanged', async () => {
    const before = (await get().expect(200)).body;
    await patch({ modules: { students: { on: false } } }).expect(400); // core area
    await patch({ modules: { fees: { lock: 'on' } } }).expect(400); // platform-owned
    await patch({ modules: { fees: { offForRoles: ['ADMIN'] } } }).expect(400);
    await patch({ labels: { class: { bn: 'x'.repeat(41) } } }).expect(400);
    await patch({ labels: { class: { bn: '<b>x</b>' } } }).expect(400);
    const after = (await get().expect(200)).body;
    expect(after.modules).toEqual(before.modules);
    expect(after.labels).toEqual(before.labels);
  });

  it('error text never echoes the submitted value', async () => {
    const res = await patch({ labels: { class: { bn: '<script>zzz</script>' } } }).expect(400);
    expect(JSON.stringify(res.body)).not.toContain('zzz');
  });

  it('denies ACCOUNTANT and other non-admin roles with 403', async () => {
    const before = (await get().expect(200)).body.modules;
    for (const role of DENIED_ROLES) {
      await patch({ modules: { homework: { on: false } } }, { role }).expect(403);
    }
    expect((await get().expect(200)).body.modules).toEqual(before);
  });

  it('missing or unknown X-Tenant-ID is 401, a foreign tenant is 403', async () => {
    // This stack answers a missing or unknown tenant with 401 (same as study-plans-settings), not 400/403.
    await supertest(app.getHttpServer())
      .patch(settingsUrl(TENANT_ID))
      .set('Authorization', `Bearer ${token}`)
      .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, modules: { homework: { on: false } } })
      .expect(401);
    await supertest(app.getHttpServer())
      .patch(settingsUrl(TENANT_ID))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', '00000000-0000-4000-8000-00000000dead')
      .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, modules: { homework: { on: false } } })
      .expect(401);
    // A real tenant the caller is not a member of is 403.
    await patch(
      { modules: { homework: { on: false } } },
      { tenant: OTHER_TENANT_ID, schoolId: TENANT_ID },
    ).expect(403);
  });

  it('blocks cross-tenant writes and leaves the other tenant unaffected', async () => {
    await patch(
      { modules: { homework: { on: false } } },
      { tenant: OTHER_TENANT_ID, schoolId: TENANT_ID },
    ).expect(403);
    const other = (await get(OTHER_TENANT_ID).expect(200)).body;
    expect(other.modules).toEqual({});
    expect(other.labels).toEqual({});
  });
});
