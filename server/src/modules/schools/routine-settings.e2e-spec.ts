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
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c5011';

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

/**
 * [8.10.7.0-s3] `PATCH /schools/:id/settings` with a `routine` block, end to
 * end: it is stored (PATCH response and GET agree), it changes the changeover
 * suggestion, a cleared cap sticks, validation still runs, only
 * `SETTINGS_MANAGE` roles may write it, and tenants are isolated.
 *
 * The seeded admin is given one membership per role so `X-Role` can probe the
 * role matrix with a single login.
 */
describe('Routine settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;
  const settingsUrl = (id: string) => `${API}/schools/${id}/settings`;

  const patch = (routine: Record<string, unknown>, role?: UserRole, tenant = TENANT_ID) => {
    const req = supertest(app.getHttpServer())
      .patch(settingsUrl(TENANT_ID))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant);
    if (role) req.set('X-Role', role);
    return req.send({ version: TENANT_SETTINGS_SCHEMA_VERSION, routine });
  };

  const getSettings = (tenant = TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(settingsUrl(tenant))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .expect(200);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    // Inserted before login: ContextGuard reads memberships embedded in the JWT.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Routine Settings School', 'other-routine-settings-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    for (const role of [UserRole.SUPER_ADMIN, ...DENIED_ROLES]) {
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
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('stores routine: the PATCH response and the next GET both show it', async () => {
    const routine = {
      defaultChangeoverMinutes: 10,
      maxPeriodsPerTeacherPerDay: 5,
      maxConsecutivePeriods: 3,
    };
    const res = await patch(routine).expect(200);
    expect(res.body.routine).toMatchObject(routine);
    expect((await getSettings()).body.routine).toMatchObject(routine);
  });

  it('uses the saved gap in the changeover suggestion', async () => {
    await patch({ defaultChangeoverMinutes: 10 }).expect(200);
    const shift = await supertest(app.getHttpServer())
      .post(`${API}/routines/shifts`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        name: 'Routine settings e2e',
        day_starts_at: '08:00',
        day_ends_at: '14:00',
        sequence: 90,
      })
      .expect(201);

    const res = await supertest(app.getHttpServer())
      .get(
        `${API}/routines/shifts/${shift.body.id}/period-slots/changeover-suggestion?periodCount=2&periodDurationMinutes=40`,
      )
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    expect(res.body[1].starts_at).toBe('08:50');
  });

  it('clears a cap sent as null', async () => {
    await patch({ defaultChangeoverMinutes: 5, maxPeriodsPerTeacherPerDay: 4 }).expect(200);
    await patch({ defaultChangeoverMinutes: 5, maxPeriodsPerTeacherPerDay: null }).expect(200);
    const { routine } = (await getSettings()).body;
    expect(routine.maxPeriodsPerTeacherPerDay).toBeUndefined();
  });

  it('still validates: a negative changeover is a 400 and the stored value is unchanged', async () => {
    await patch({ defaultChangeoverMinutes: 6 }).expect(200);
    await patch({ defaultChangeoverMinutes: -1 }).expect(400);
    expect((await getSettings()).body.routine.defaultChangeoverMinutes).toBe(6);
  });

  it.each([UserRole.ADMIN, UserRole.SUPER_ADMIN])('lets %s change routine', async (role) => {
    await patch({ defaultChangeoverMinutes: 7 }, role).expect(200);
  });

  it.each(DENIED_ROLES)('forbids %s and leaves routine unchanged', async (role) => {
    await patch({ defaultChangeoverMinutes: 8 }).expect(200);
    await patch({ defaultChangeoverMinutes: 12 }, role).expect(403);
    expect((await getSettings()).body.routine.defaultChangeoverMinutes).toBe(8);
  });

  it('is tenant-isolated: a tenant-2 admin cannot write tenant 1, and its routine never leaks', async () => {
    await patch({ defaultChangeoverMinutes: 9 }).expect(200);
    // URL targets tenant 1, header says tenant 2.
    await patch({ defaultChangeoverMinutes: 20 }, UserRole.ADMIN, OTHER_TENANT_ID).expect(403);
    expect((await getSettings()).body.routine.defaultChangeoverMinutes).toBe(9);
    expect((await getSettings(OTHER_TENANT_ID)).body.routine?.defaultChangeoverMinutes).not.toBe(9);
  });

  it('rejects a request without X-Tenant-ID with 401', async () => {
    await supertest(app.getHttpServer())
      .patch(settingsUrl(TENANT_ID))
      .set('Authorization', `Bearer ${token}`)
      .send({ version: TENANT_SETTINGS_SCHEMA_VERSION, routine: { defaultChangeoverMinutes: 5 } })
      .expect(401);
  });
});
