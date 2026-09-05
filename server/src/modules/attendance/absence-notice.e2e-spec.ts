import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
} from '@test/constants';

/**
 * E2E tests for [9.8]'s `POST .../absence-notice/preview` and `.../send`.
 *
 * These routes are gated to ADMIN/EXECUTIVE, not TEACHER — deciding
 * whether to text every absent child's guardian is a school-policy action,
 * covered here rather than in `attendance.e2e-spec.ts` since it is a
 * separate controller with its own role list.
 */
describe('Absence Notice E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const SECTION_ID = SEED_SECTION_1_ID;
  // Valid UUID shape, but no `user_tenants` row for the admin — same
  // convention `fee-structures.e2e-spec.ts` uses for "invalid/non-member
  // X-Tenant-ID", which also doubles as the tenant-isolation case: the
  // admin's token proves nothing about a tenant they aren't a member of.
  const NON_MEMBER_TENANT_ID = '00000000-0000-4000-8000-000000000098';

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

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

    await dataSource.query(`UPDATE schools SET settings = $1 WHERE id = $2`, [
      JSON.stringify({
        version: 1,
        attendance: {
          weeklyOffDays: [],
          autoAbsentNotification: { enabled: false, cutoffTime: '00:00' },
        },
      }),
      TENANT_ID,
    ]);

    const adminLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = adminLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;
  });

  describe('POST /attendance/sections/:sectionId/absence-notice/preview', () => {
    it('returns 200 for ADMIN', async () => {
      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${SECTION_ID}/absence-notice/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ date: todayIso() })
        .expect(200);

      expect(res.body).toHaveProperty('recipients');
      expect(res.body).toHaveProperty('skipped');
      expect(res.body).toHaveProperty('message_preview');
    });

    it('returns 401 for TEACHER', async () => {
      await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${SECTION_ID}/absence-notice/preview`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({ date: todayIso() })
        .expect(401);
    });

    it('returns 401 for an invalid/non-member X-Tenant-ID', async () => {
      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${SECTION_ID}/absence-notice/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', NON_MEMBER_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ date: todayIso() })
        .expect(401);

      expect(res.body.message).toContain('not a member of tenant');
    });

    it('writes a REMINDER_PREVIEWED audit row', async () => {
      await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${SECTION_ID}/absence-notice/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ date: todayIso() })
        .expect(200);

      const rows = await dataSource.query(
        `SELECT action FROM audit_logs
         WHERE tenant_id = $1 AND action = 'REMINDER_PREVIEWED'
         ORDER BY created_at DESC LIMIT 1`,
        [TENANT_ID],
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('POST /attendance/sections/:sectionId/absence-notice/send', () => {
    it('returns 200 for ADMIN even with no finalized register (skipped_reason: no_session)', async () => {
      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${SECTION_ID}/absence-notice/send`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ date: '2020-01-01' })
        .expect(200);

      expect(res.body.batch_id).toBeNull();
      expect(res.body.skipped_reason).toBe('no_session');
    });

    it('returns 401 for TEACHER', async () => {
      await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${SECTION_ID}/absence-notice/send`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .send({ date: todayIso() })
        .expect(401);
    });

    it('returns 401 when X-Tenant-ID is missing', async () => {
      await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${SECTION_ID}/absence-notice/send`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ date: todayIso() })
        .expect(401);
    });

    it('returns 401 for an invalid/non-member X-Tenant-ID', async () => {
      const res = await supertest(app.getHttpServer())
        .post(`/api/v1/attendance/sections/${SECTION_ID}/absence-notice/send`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', NON_MEMBER_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .send({ date: todayIso() })
        .expect(401);

      expect(res.body.message).toContain('not a member of tenant');
    });
  });
});
