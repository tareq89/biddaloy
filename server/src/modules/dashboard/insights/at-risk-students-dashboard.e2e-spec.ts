import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import type { Queue } from 'bullmq';
import { UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { TENANT_STATUS_REDIS } from '../../schools/tenant-status.service';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';
import { AtRiskService } from './at-risk.service';
import { AT_RISK_QUEUE } from './at-risk.constants';

/** E2E for `GET /dashboard/widgets/at-risk-students` (#1853): D46 role matrix, cache states, limit. */

const API = '/api/v1';
const URL = `${API}/dashboard/widgets/at-risk-students`;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000185300a1';
const ROLES = Object.values(UserRole);

describe('GET /dashboard/widgets/at-risk-students', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let queue: Queue;
  let atRisk: AtRiskService;
  let token: string;

  const call = (role: UserRole, query = '', tenantId = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(`${URL}${query}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId)
      .set('X-Role', role);

  const clearCache = async () => {
    await redis.del(atRisk.listKey(SEED_TENANT_ID));
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);
    redis = app.get<Redis>(TENANT_STATUS_REDIS);
    queue = app.get<Queue>(getQueueToken(AT_RISK_QUEUE));
    atRisk = app.get(AtRiskService);

    for (const role of ROLES) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'at-risk-other', 'at-risk-other', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    token = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
  }, 120000);

  afterAll(async () => {
    await clearCache();
    await dataSource.query(`UPDATE schools SET settings = settings - 'dashboard' WHERE id = $1`, [
      SEED_TENANT_ID,
    ]);
    await app.close();
  });

  describe('D46 role matrix', () => {
    it('catalogue roles are exactly ADMIN and EXECUTIVE', () => {
      expect([...WIDGET_CATALOGUE['at-risk-students'].roles].sort()).toEqual(
        [UserRole.ADMIN, UserRole.EXECUTIVE].sort(),
      );
    });

    it.each([UserRole.ADMIN, UserRole.EXECUTIVE])('200 for %s', async (r) => {
      await call(r).expect(200);
    });

    it.each([
      UserRole.ACCOUNTANT,
      UserRole.TEACHER,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
      UserRole.PARENT,
      UserRole.STUDENT,
    ])('403 for %s', async (r) => {
      await call(r).expect(403);
    });

    it("another tenant's X-Tenant-ID is refused (401/403)", async () => {
      const res = await call(UserRole.ADMIN, '', OTHER_TENANT_ID);
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('cache states', () => {
    it('empty cache -> COMPUTING and a tenant job is queued; after it runs -> READY', async () => {
      await clearCache();
      const add = vi.spyOn(queue, 'add');
      const first = await call(UserRole.ADMIN).expect(200);
      expect(first.body.state).toBe('COMPUTING');
      expect(first.body.students).toEqual([]);
      expect(add).toHaveBeenCalledWith(
        'tenant',
        { tenantId: SEED_TENANT_ID },
        expect.objectContaining({ jobId: `at-risk-students-${SEED_TENANT_ID}` }),
      );
      add.mockRestore();

      await atRisk.refresh(SEED_TENANT_ID);
      const second = await call(UserRole.ADMIN).expect(200);
      expect(second.body.state).toBe('READY');
      expect(second.body.stale).toBe(false);
    });

    it('a changed threshold marks the stored list stale', async () => {
      await atRisk.refresh(SEED_TENANT_ID);
      await dataSource.query(
        `UPDATE schools SET settings = jsonb_set(COALESCE(settings, '{"version":1}'::jsonb), '{dashboard}',
           '{"risk":{"absentStreakDays":9,"monthlyAttendancePct":75,"failedSubjects":1,"overdueDays":60},"committeeAttendanceTargetPct":90,"digestTime":"07:30"}'::jsonb)
         WHERE id = $1`,
        [SEED_TENANT_ID],
      );
      const res = await call(UserRole.ADMIN).expect(200);
      expect(res.body.state).toBe('READY');
      expect(res.body.stale).toBe(true);
    });
  });

  describe('limit', () => {
    it.each(['0', '201'])('?limit=%s is 400', async (limit) => {
      await call(UserRole.ADMIN, `?limit=${limit}`).expect(400);
    });
  });

  // server/CLAUDE.md: always test a missing X-Tenant-ID.
  it('missing X-Tenant-ID returns 401', async () => {
    await supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
