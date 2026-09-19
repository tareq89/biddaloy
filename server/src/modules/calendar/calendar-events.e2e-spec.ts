import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole, CalendarAudience, CalendarEventType } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * E2E tests for `/calendar/events` — full HTTP stack: auth, tenant
 * context, permission guard, and cross-tenant isolation.
 */
describe('Calendar Events E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000098';
  let academicYearId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ('${OTHER_TENANT_ID}', 'Calendar Events Other School', 'calendar-events-other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    // The admin user must hold a membership in tenant B too, so a
    // cross-tenant request reaches CalendarEventsService (and gets 404 for
    // tenant scoping) rather than being rejected at ContextGuard (401 for
    // not being a member at all).
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${OTHER_TENANT_ID}', '${UserRole.ADMIN}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    const yearRes = await dataSource.query(
      `INSERT INTO academic_years (id, name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES (gen_random_uuid(), 'Calendar Events E2E Year', '2031-01-01', '2031-12-31', '${TENANT_ID}', NOW(), NOW())
       RETURNING id`,
    );
    academicYearId = yearRes[0].id;

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    // The STUDENT-role test below adds a second `user_tenants` row for the
    // seed admin user in the seed tenant — this worker's database is shared
    // by every spec file that runs on it, so leaving that row behind would
    // give the seed admin an extra STUDENT membership in specs that run
    // after this one.
    await dataSource.query(
      `DELETE FROM user_tenants WHERE user_id = '${SEED_ADMIN_USER_ID}' AND tenant_id = '${TENANT_ID}' AND role = '${UserRole.STUDENT}'`,
    );
    await app.close();
  });

  it('ADMIN can create a calendar event', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        type: CalendarEventType.EVENT,
        name: 'E2E Event',
        start_date: '2031-02-01',
        end_date: '2031-02-01',
        audience: CalendarAudience.ALL,
      })
      .expect(201);

    expect(res.body.id).toBeDefined();
    expect(res.body.academic_year_id).toBe(academicYearId);
  });

  it('returns 401 with missing X-Tenant-ID', async () => {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        type: CalendarEventType.EVENT,
        name: 'No Tenant',
        start_date: '2031-02-02',
        end_date: '2031-02-02',
        audience: CalendarAudience.ALL,
      })
      .expect(401);

    expect(res.body.message).toBe('X-Tenant-ID header is required');
  });

  it('STUDENT cannot create an event (RolesGuard rejects before PermissionsGuard runs)', async () => {
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const studentToken = loginRes.body.access_token;

    await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .send({
        type: CalendarEventType.EVENT,
        name: 'Denied',
        start_date: '2031-02-03',
        end_date: '2031-02-03',
        audience: CalendarAudience.ALL,
      })
      .expect(401);
  });

  it('STUDENT can list events (holds CALENDAR_READ)', async () => {
    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const studentToken = loginRes.body.access_token;

    await supertest(app.getHttpServer())
      .get('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .expect(200);
  });

  it('returns 401 with an invalid X-Tenant-ID (not a membership the caller holds)', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000000')
      .expect(401);
  });

  it('STUDENT cannot update/delete/publish an event (RolesGuard denies both directions)', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        type: CalendarEventType.EVENT,
        name: 'Guarded for STUDENT',
        start_date: '2031-02-07',
        end_date: '2031-02-07',
        audience: CalendarAudience.ALL,
        publish: false,
      })
      .expect(201);

    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    const studentToken = loginRes.body.access_token;

    await supertest(app.getHttpServer())
      .patch(`/api/v1/calendar/events/${createRes.body.id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .send({ name: 'Denied patch' })
      .expect(401);

    await supertest(app.getHttpServer())
      .post(`/api/v1/calendar/events/${createRes.body.id}/publish`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .expect(401);

    await supertest(app.getHttpServer())
      .delete(`/api/v1/calendar/events/${createRes.body.id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .expect(401);

    // STUDENT (no CALENDAR_MANAGE) must not see this draft by id either —
    // matches `list()`'s draft rule (D9).
    await supertest(app.getHttpServer())
      .get(`/api/v1/calendar/events/${createRes.body.id}`)
      .set('Authorization', `Bearer ${studentToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .expect(404);
  });

  it('tenant A cannot read tenant B calendar event', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        type: CalendarEventType.EVENT,
        name: 'Tenant A Only',
        start_date: '2031-02-05',
        end_date: '2031-02-05',
        audience: CalendarAudience.ALL,
      })
      .expect(201);

    await supertest(app.getHttpServer())
      .get(`/api/v1/calendar/events/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', OTHER_TENANT_ID)
      .expect(404);
  });

  it('tenant A cannot patch tenant B calendar event', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        type: CalendarEventType.EVENT,
        name: 'Tenant A Patch Target',
        start_date: '2031-02-06',
        end_date: '2031-02-06',
        audience: CalendarAudience.ALL,
      })
      .expect(201);

    await supertest(app.getHttpServer())
      .patch(`/api/v1/calendar/events/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', OTHER_TENANT_ID)
      .send({ name: 'Hijacked' })
      .expect(404);
  });

  it('validates DTO shape (400 on missing required fields)', async () => {
    await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({})
      .expect(400);
  });

  it('publishes a draft event via POST /calendar/events/:id/publish', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        type: CalendarEventType.EVENT,
        name: 'Draft to publish',
        start_date: '2031-03-01',
        end_date: '2031-03-01',
        audience: CalendarAudience.ALL,
        publish: false,
      })
      .expect(201);
    expect(createRes.body.published).toBeFalsy();

    const publishRes = await supertest(app.getHttpServer())
      .post(`/api/v1/calendar/events/${createRes.body.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(201);

    expect(publishRes.body.published).toBe(true);
  });

  it('deletes an event', async () => {
    const createRes = await supertest(app.getHttpServer())
      .post('/api/v1/calendar/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        type: CalendarEventType.EVENT,
        name: 'To delete',
        start_date: '2031-03-05',
        end_date: '2031-03-05',
        audience: CalendarAudience.ALL,
      })
      .expect(201);

    await supertest(app.getHttpServer())
      .delete(`/api/v1/calendar/events/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    await supertest(app.getHttpServer())
      .get(`/api/v1/calendar/events/${createRes.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(404);
  });
});
