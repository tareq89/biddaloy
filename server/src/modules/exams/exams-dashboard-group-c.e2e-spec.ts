import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { DashboardWidgetKey, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/** E2E for the group-C exam widgets (#1891): D46 role matrix, tenant gate, no PII. */

const API = '/api/v1';
const FOREIGN_TENANT_ID = '00000000-0000-4000-8000-000001891002';

const PII_KEYS = [
  'full_name',
  'student_name',
  'guardian_name',
  'name',
  'phone',
  'email',
  'registration_number',
  'roll_number',
  'address',
];

/** Every key at any depth. */
const allKeys = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.flatMap(allKeys)
    : v && typeof v === 'object'
      ? Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)])
      : [];

describe('exam dashboard group C widgets', () => {
  let app: INestApplication;
  let redis: Redis;
  let token: string;

  const call = (path: string, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = supertest(app.getHttpServer())
      .get(`${API}/dashboard/widgets/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', role);
    return tenantId ? req.set('X-Tenant-ID', tenantId) : req;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);
    redis = app.get<Redis>(TENANT_STATUS_REDIS);
    // One login, one membership per role, switched with X-Role.
    for (const role of Object.values(UserRole)) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'group-c-foreign', 'group-c-foreign', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [FOREIGN_TENANT_ID],
    );
    token = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 120000);

  afterAll(async () => {
    for (const key of [DashboardWidgetKey.COMMITTEE_PASS_RATE, DashboardWidgetKey.RESULTS_STATE]) {
      await redis.del(`tenant:${SEED_TENANT_ID}:dash:v1:${key}:school`);
    }
    await app.close();
  });

  const routes: Array<[string, UserRole[]]> = [
    ['committee-pass-rate', [UserRole.COMMITTEE, UserRole.ADMIN, UserRole.EXECUTIVE]],
    ['results-state', [UserRole.EXAM_CONTROLLER, UserRole.ADMIN, UserRole.EXECUTIVE]],
  ];

  describe.each(routes)('GET /dashboard/widgets/%s', (path, allowed) => {
    // One `it` per role: allowed -> 200, everyone else -> 403
    // (OFFICE_STAFF and TEACHER hold RESULT_READ but are not catalogue roles).
    it.each(Object.values(UserRole).filter((r) => r !== UserRole.SUPER_ADMIN))(
      'role %s gets the expected status',
      async (role) => {
        const res = await call(path, role);
        expect(res.status).toBe(allowed.includes(role) ? 200 : 403);
        if (path === 'results-state' && res.status === 403 && role === UserRole.OFFICE_STAFF) {
          expect(JSON.stringify(res.body)).toContain('DASHBOARD_WIDGET_ROLE');
        }
      },
    );

    it('missing X-Tenant-ID is rejected', async () => {
      const res = await call(path, UserRole.ADMIN, null);
      expect([400, 401, 403]).toContain(res.status);
    });

    it("another school's X-Tenant-ID is refused (401/403)", async () => {
      const res = await call(path, UserRole.ADMIN, FOREIGN_TENANT_ID);
      expect([401, 403]).toContain(res.status);
    });

    it('invalid X-Tenant-ID is rejected', async () => {
      const res = await call(path, UserRole.ADMIN, 'not-a-uuid');
      expect([400, 401, 403, 404]).toContain(res.status);
    });
  });

  it('committee-pass-rate: empty shape and no PII or id keys', async () => {
    const res = await call('committee-pass-rate', UserRole.COMMITTEE).expect(200);
    expect(Object.keys(res.body).sort()).toEqual([
      'classes',
      'exam_name',
      'overall_pass_percentage',
      'previous_pass_percentage',
      'recent_rounds',
    ]);
    for (const k of allKeys(res.body)) {
      expect(k === 'id' || k.endsWith('_id') || PII_KEYS.includes(k)).toBe(false);
    }
  });

  it('results-state: keys match the DTO', async () => {
    const res = await call('results-state', UserRole.EXAM_CONTROLLER).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['draft', 'processed', 'published', 'rounds']);
  });
});
