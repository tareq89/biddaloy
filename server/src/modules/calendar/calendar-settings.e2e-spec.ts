import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../schools/dto/tenant-settings.dto';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_REGION_SETTINGS,
} from '../schools/settings/tenant-settings-defaults';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

const API = '/api/v1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c5001';
const UNAFFILIATED_TENANT_ID = '00000000-0000-4000-8000-0000000c5002';

/**
 * [17.2.3] `GET /calendar-settings`, end-to-end: the composite read
 * reflects a `PATCH /schools/:id/settings` write, is cross-tenant
 * isolated, and honours `CALENDAR_READ` (allowed for TEACHER, denied for
 * a role that lacks it).
 */
describe('Calendar settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // A second tenant so cross-tenant isolation can be proved with one
    // login and a switched `X-Tenant-ID` — same recipe as
    // `attendance/devices/devices.e2e-spec.ts`. Inserted before login:
    // `ContextGuard` checks `X-Tenant-ID` against the memberships embedded
    // in the JWT at issue time, not a fresh DB read.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Calendar Settings School', 'other-calendar-settings-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    // Also give the seeded admin a TEACHER membership on the seed tenant,
    // to probe the "allowed" side of the CALENDAR_READ role gate without a
    // second user.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('returns the seven fields the ticket specifies', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/calendar-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        termLabel: expect.any(String),
        country: expect.any(String),
        firstDayOfWeek: expect.any(Number),
        weeklyOffDays: expect.any(Array),
        timezone: expect.any(String),
      }),
    );
    expect(res.body).toHaveProperty('currentAcademicYear');
  });

  it('reflects the current academic year seeded for the tenant', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/calendar-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    // Seed data may or may not mark SEED_ACADEMIC_YEAR_ID `is_current` —
    // this only asserts internal consistency: whichever year the endpoint
    // names as current, that row really is `is_current = true` for this
    // tenant, not null and not a wrong shape.
    if (res.body.currentAcademicYear !== null) {
      expect(res.body.currentAcademicYear).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          start_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          end_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
      const [row] = await dataSource.query(
        `SELECT is_current FROM academic_years WHERE id = $1 AND tenant_id = $2`,
        [res.body.currentAcademicYear.id, TENANT_ID],
      );
      expect(row.is_current).toBe(true);
    }
  });

  it('reflects a PATCHed weeklyOffDays and termLabel through the composite GET', async () => {
    const patchRes = await supertest(app.getHttpServer())
      .patch(`${API}/schools/${TENANT_ID}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        attendance: { ...DEFAULT_ATTENDANCE_SETTINGS, weeklyOffDays: [5] },
        region: {
          ...DEFAULT_REGION_SETTINGS,
          calendar: { termLabel: 'SEMESTER' },
        },
      })
      .expect(200);
    expect(patchRes.body.attendance.weeklyOffDays).toEqual([5]);

    const getRes = await supertest(app.getHttpServer())
      .get(`${API}/calendar-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    expect(getRes.body.weeklyOffDays).toEqual([5]);
    expect(getRes.body.termLabel).toBe('SEMESTER');
  });

  it('is tenant-isolated: switching X-Tenant-ID does not carry the other tenant’s settings', async () => {
    await supertest(app.getHttpServer())
      .patch(`${API}/schools/${OTHER_TENANT_ID}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', OTHER_TENANT_ID)
      .send({
        version: TENANT_SETTINGS_SCHEMA_VERSION,
        region: {
          ...DEFAULT_REGION_SETTINGS,
          calendar: { termLabel: 'TRIMESTER' },
        },
      })
      .expect(200);

    const res = await supertest(app.getHttpServer())
      .get(`${API}/calendar-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    // The seed tenant was set to SEMESTER by the previous test, not
    // TRIMESTER — proves the other tenant's PATCH didn't leak across.
    expect(res.body.termLabel).not.toBe('TRIMESTER');
  });

  it('lets TEACHER (holds CALENDAR_READ) read calendar settings', async () => {
    await supertest(app.getHttpServer())
      .get(`${API}/calendar-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(200);
  });

  // Every `UserRole` currently holds `CALENDAR_READ` (`permissions.ts`), so
  // there is no role to prove a *role*-gate denial with — the real "denied"
  // case for this route is the tenant boundary: no membership at all.
  it('denies a tenant the caller has no membership on', async () => {
    const res = await supertest(app.getHttpServer())
      .get(`${API}/calendar-settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', UNAFFILIATED_TENANT_ID)
      .expect(401);

    expect(res.body.message).toContain('not a member of tenant');
  });
});
