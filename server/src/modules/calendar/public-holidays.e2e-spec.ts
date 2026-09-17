import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { PublicHolidayFetchService } from './public-holiday-fetch.service';
import { PublicHolidaySource } from '@biddaloy/shared';

const API = '/api/v1';

/**
 * E2E for [17.2.4]'s two route families: `/platform/holiday-sets/*`
 * (SUPER_ADMIN curation) and `/calendar/public-holidays/*` (tenant
 * suggest/bulk-add). `PublicHolidayFetchService.fetch` is mocked at the
 * app level — this suite never makes a real outbound call, matching D10's
 * "no tenant route ever calls the external source" (also asserted
 * directly by never overriding the mock in the tenant-route tests below).
 */
describe('Public holiday sets (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let superAdminToken: string;
  let otherAdminToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000c7002';
  const SUPER_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000c7001';
  const SUPER_ADMIN_EMAIL = 'superadmin@public-holidays-e2e.example';
  const OTHER_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000c7003';
  const OTHER_ADMIN_EMAIL = 'admin@public-holidays-other-e2e.example';

  const fetchMock = vi.fn();

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PublicHolidayFetchService)
      .useValue({ fetch: fetchMock })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other Public Holidays School', 'other-public-holidays-e2e', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Public Holidays Super Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, SUPER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, TENANT_ID, UserRole.SUPER_ADMIN],
    );

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Other Tenant Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_USER_ID, OTHER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );

    // Wide academic years so every fixed test date below (2031-2033)
    // resolves via `CalendarEventsService.resolveAcademicYear` when
    // `bulkAdd` calls `create`.
    for (const tenantId of [TENANT_ID, OTHER_TENANT_ID]) {
      await dataSource.query(
        `INSERT INTO academic_years (id, name, start_date, end_date, tenant_id, created_at, updated_at)
         SELECT gen_random_uuid(), 'Public Holidays E2E Year', '2031-01-01', '2033-12-31', $1, NOW(), NOW()
         WHERE NOT EXISTS (
           SELECT 1 FROM academic_years
           WHERE tenant_id = $1 AND start_date <= '2031-01-01' AND end_date >= '2033-12-31'
         )`,
        [tenantId],
      );
    }

    const loginAs = async (email: string) => {
      const res = await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token as string;
    };

    adminToken = await loginAs(SEED_ADMIN_EMAIL);
    superAdminToken = await loginAs(SUPER_ADMIN_EMAIL);
    otherAdminToken = await loginAs(OTHER_ADMIN_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects ADMIN fetching a platform holiday set with 401 (role guard)', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/platform/holiday-sets/fetch`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ country: 'BD', year: 2031 })
      .expect(401);
  });

  it('SUPER_ADMIN can fetch, edit, and publish a BD 2031 set from a mocked source', async () => {
    fetchMock.mockResolvedValueOnce({
      source: PublicHolidaySource.GOOGLE_ICS,
      entries: [{ date: '2031-01-01', end_date: '2031-01-01', name: 'New Year' }],
    });

    const fetchRes = await supertest(app.getHttpServer())
      .post(`${API}/platform/holiday-sets/fetch`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ country: 'BD', year: 2031 })
      .expect(201);

    expect(fetchRes.body.country).toBe('BD');
    expect(fetchRes.body.published_at).toBeNull();
    expect(fetchRes.body.entries).toHaveLength(1);
    const setId = fetchRes.body.id;
    const entryId = fetchRes.body.entries[0].id;

    const editRes = await supertest(app.getHttpServer())
      .put(`${API}/platform/holiday-sets/${setId}/entries`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({
        entries: [
          {
            id: entryId,
            date: '2031-01-01',
            end_date: '2031-01-01',
            name: 'New Year',
            name_bn: 'নববর্ষ',
          },
        ],
      })
      .expect(200);
    expect(editRes.body.entries[0].name_bn).toBe('নববর্ষ');

    const publishRes = await supertest(app.getHttpServer())
      .post(`${API}/platform/holiday-sets/${setId}/publish`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(201);
    expect(publishRes.body.published_at).not.toBeNull();
  });

  it('returns 502 PUBLIC_HOLIDAY_SOURCE_UNAVAILABLE when the source fails', async () => {
    const { PublicHolidaySourceUnavailableError } = await import('./public-holiday-fetch.service');
    fetchMock.mockRejectedValueOnce(new PublicHolidaySourceUnavailableError('PK', 2031));

    const res = await supertest(app.getHttpServer())
      .post(`${API}/platform/holiday-sets/fetch`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ country: 'PK', year: 2031 })
      .expect(502);

    expect(res.body.details?.code ?? res.body.message).toBeTruthy();
  });

  it('school sees only published sets for its own country/year and adds ticked rows as HOLIDAY events; never calls the external source', async () => {
    fetchMock.mockResolvedValueOnce({
      source: PublicHolidaySource.GOOGLE_ICS,
      entries: [
        { date: '2032-02-15', end_date: '2032-02-15', name: 'Language Day' },
        { date: '2032-03-26', end_date: '2032-03-26', name: 'Independence Day' },
      ],
    });
    const fetchRes = await supertest(app.getHttpServer())
      .post(`${API}/platform/holiday-sets/fetch`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ country: 'BD', year: 2032 })
      .expect(201);
    const setId = fetchRes.body.id;

    fetchMock.mockClear();

    // Not published yet — the tenant sees nothing.
    const beforePublish = await supertest(app.getHttpServer())
      .get(`${API}/calendar/public-holidays?year=2032`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);
    expect(beforePublish.body).toEqual([]);

    await supertest(app.getHttpServer())
      .post(`${API}/platform/holiday-sets/${setId}/publish`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(201);

    const suggestRes = await supertest(app.getHttpServer())
      .get(`${API}/calendar/public-holidays?year=2032`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);
    expect(suggestRes.body).toHaveLength(2);
    expect(suggestRes.body.every((entry: { already_added: boolean }) => !entry.already_added)).toBe(
      true,
    );

    const entryIds = suggestRes.body.map((entry: { id: string }) => entry.id);
    const addRes = await supertest(app.getHttpServer())
      .post(`${API}/calendar/public-holidays/add`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ entry_ids: entryIds })
      .expect(201);
    expect(addRes.body.added).toBe(2);

    const afterAdd = await supertest(app.getHttpServer())
      .get(`${API}/calendar/public-holidays?year=2032`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);
    expect(afterAdd.body.every((entry: { already_added: boolean }) => entry.already_added)).toBe(
      true,
    );

    // The external source (Google/Nager) was never touched by either
    // tenant-side call above (D10).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tenant A adding holidays never affects tenant B', async () => {
    fetchMock.mockResolvedValueOnce({
      source: PublicHolidaySource.GOOGLE_ICS,
      entries: [{ date: '2033-05-01', end_date: '2033-05-01', name: 'May Day' }],
    });
    const fetchRes = await supertest(app.getHttpServer())
      .post(`${API}/platform/holiday-sets/fetch`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ country: 'BD', year: 2033 })
      .expect(201);
    await supertest(app.getHttpServer())
      .post(`${API}/platform/holiday-sets/${fetchRes.body.id}/publish`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(201);

    const suggestForA = await supertest(app.getHttpServer())
      .get(`${API}/calendar/public-holidays?year=2033`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);

    await supertest(app.getHttpServer())
      .post(`${API}/calendar/public-holidays/add`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .send({ entry_ids: suggestForA.body.map((e: { id: string }) => e.id) })
      .expect(201);

    // Tenant B's country doesn't match BD's fetched set — country default
    // for the other school is also BD (tenant settings default), so this
    // asserts tenant B's own calendar events are unaffected by A's add,
    // not that B sees nothing (it may see the same published suggestion —
    // that's expected, since D10's set is shared across tenants in the
    // same country/year; what must never happen is B's calendar itself
    // gaining an event from A's `add` call).
    const suggestForB = await supertest(app.getHttpServer())
      .get(`${API}/calendar/public-holidays?year=2033`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .set('X-Tenant-ID', OTHER_TENANT_ID)
      .expect(200);
    expect(
      suggestForB.body.every((entry: { already_added: boolean }) => !entry.already_added),
    ).toBe(true);
  });
});
