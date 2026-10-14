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
import { DEFAULT_DASHBOARD_SETTINGS } from './settings/tenant-settings-defaults';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

const API = '/api/v1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000d1836';
const DENIED_ROLES = [
  UserRole.ACCOUNTANT,
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

/** [8.10.7] `settings.dashboard` through `PATCH/GET /schools/:id/settings`. */
describe('Dashboard settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;
  const settingsUrl = (id: string) => `${API}/schools/${id}/settings`;

  /** PATCH `schoolId`'s settings as the seeded admin acting in `tenant` (and optionally `role`). */
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
    dataSource.query(`UPDATE schools SET settings = settings - 'dashboard' WHERE id = ANY($1)`, [
      [TENANT_ID, OTHER_TENANT_ID],
    ]);

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
       VALUES ($1, 'Other Dashboard School', 'other-dashboard-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    // Same user holds every role on the seed tenant so `X-Role` can probe the matrix.
    for (const role of [...DENIED_ROLES, UserRole.SUPER_ADMIN]) {
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
    // Remove the extra role memberships added in beforeAll so other specs see the seed admin unchanged.
    await dataSource.query(
      `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`,
      [SEED_ADMIN_USER_ID, TENANT_ID, [...DENIED_ROLES, UserRole.SUPER_ADMIN]],
    );
    await app.close();
  });

  const FULL = {
    risk: { absentStreakDays: 4, monthlyAttendancePct: 80, failedSubjects: 1, overdueDays: 45 },
    committeeAttendanceTargetPct: 92,
    digestTime: '07:15',
  };

  it('round trips: PATCH stores the block, GET matches', async () => {
    const res = await patch({ dashboard: FULL }).expect(200);
    expect(res.body.dashboard).toEqual(FULL);
    expect((await get().expect(200)).body.dashboard).toEqual(FULL);
  });

  it('a school that never saved gets the defaults', async () => {
    expect((await get(OTHER_TENANT_ID).expect(200)).body.dashboard).toEqual(
      DEFAULT_DASHBOARD_SETTINGS,
    );
  });

  it('rejects a bad digestTime with 400 and leaves the stored block unchanged', async () => {
    const before = (await get().expect(200)).body.dashboard;
    await patch({ dashboard: { digestTime: '25:00' } }).expect(400);
    expect((await get().expect(200)).body.dashboard).toEqual(before);
  });

  it('lets ADMIN and SUPER_ADMIN change it', async () => {
    for (const role of [UserRole.ADMIN, UserRole.SUPER_ADMIN]) {
      await patch({ dashboard: FULL }, { role }).expect(200);
    }
  });

  it('denies every other role with 403 and leaves the value unchanged', async () => {
    const before = (await get().expect(200)).body.dashboard;
    for (const role of DENIED_ROLES) {
      await patch({ dashboard: { digestTime: '10:00' } }, { role }).expect(403);
    }
    expect((await get().expect(200)).body.dashboard).toEqual(before);
  });

  it('blocks cross-tenant writes and never leaks values across tenants', async () => {
    const before = (await get().expect(200)).body.dashboard;
    await patch(
      { dashboard: { digestTime: '12:00' } },
      { tenant: OTHER_TENANT_ID, schoolId: TENANT_ID },
    ).expect(403);
    expect((await get().expect(200)).body.dashboard).toEqual(before);
    expect((await get(OTHER_TENANT_ID).expect(200)).body.dashboard).toEqual(
      DEFAULT_DASHBOARD_SETTINGS,
    );
  });

  it('401s without X-Tenant-ID', async () => {
    await supertest(app.getHttpServer())
      .patch(settingsUrl(TENANT_ID))
      .set('Authorization', `Bearer ${token}`)
      .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, dashboard: { digestTime: '08:00' } })
      .expect(401);
  });
});
