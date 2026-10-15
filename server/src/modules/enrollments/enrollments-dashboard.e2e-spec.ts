import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { DashboardWidgetKey, UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
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

/** E2E for `GET /dashboard/widgets/committee-enrollment` (#1888): D46 role matrix, tenant gate, no PII. */

const API = '/api/v1';
const URL = `${API}/dashboard/widgets/committee-enrollment`;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000018880001';
const ROLES = Object.values(UserRole);
// Keys that would identify a person (or a record of one).
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

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

describe('GET /dashboard/widgets/committee-enrollment', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let token: string;

  const get = (role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };
  const clear = () =>
    redis.del(`tenant:${SEED_TENANT_ID}:dash:v1:${DashboardWidgetKey.COMMITTEE_ENROLLMENT}:school`);

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

    // One login, one membership per role, switched with X-Role.
    for (const role of ROLES) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'committee-enrollment-other', 'committee-enrollment-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    token = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
    await clear();
  }, 120000);

  afterAll(async () => {
    await clear();
    await app.close();
  });

  it('catalogue roles are exactly COMMITTEE, ADMIN, EXECUTIVE', () => {
    expect([...WIDGET_CATALOGUE['committee-enrollment'].roles].sort()).toEqual(
      [UserRole.COMMITTEE, UserRole.ADMIN, UserRole.EXECUTIVE].sort(),
    );
  });

  it('200 for ADMIN with exactly the DTO keys', async () => {
    const res = await get(UserRole.ADMIN).expect(200);
    expect(Object.keys(res.body).sort()).toEqual(['current_count', 'previous_count', 'years']);
    expect(Array.isArray(res.body.years)).toBe(true);
  });
  it('200 for EXECUTIVE', async () => {
    await get(UserRole.EXECUTIVE).expect(200);
  });
  it('200 for COMMITTEE', async () => {
    await get(UserRole.COMMITTEE).expect(200);
  });
  it('403 for ACCOUNTANT', async () => {
    await get(UserRole.ACCOUNTANT).expect(403);
  });
  it('403 for TEACHER', async () => {
    await get(UserRole.TEACHER).expect(403);
  });
  it('403 for OFFICE_STAFF', async () => {
    await get(UserRole.OFFICE_STAFF).expect(403);
  });
  it('403 for EXAM_CONTROLLER', async () => {
    await get(UserRole.EXAM_CONTROLLER).expect(403);
  });
  it('403 for PARENT', async () => {
    await get(UserRole.PARENT).expect(403);
  });
  it('403 for STUDENT', async () => {
    await get(UserRole.STUDENT).expect(403);
  });

  it('rejects a missing X-Tenant-ID', async () => {
    const res = await get(UserRole.ADMIN, null);
    expect([400, 401, 403]).toContain(res.status);
  });
  it('rejects a malformed X-Tenant-ID', async () => {
    const res = await get(UserRole.ADMIN, 'not-a-uuid');
    expect([400, 401, 403]).toContain(res.status);
  });
  it("a school A caller with school B's header is refused", async () => {
    const res = await get(UserRole.ADMIN, OTHER_TENANT_ID);
    expect([401, 403]).toContain(res.status);
    expect(res.body).not.toHaveProperty('years');
  });

  it('body carries no id and no personal field, at any depth', async () => {
    await clear();
    const res = await get(UserRole.COMMITTEE).expect(200);
    const keys = collectKeys(res.body);
    expect(keys).toContain('year_label');
    for (const k of keys) {
      expect(k === 'id' || k.endsWith('_id') || PII_KEYS.includes(k)).toBe(false);
    }
  });
});
