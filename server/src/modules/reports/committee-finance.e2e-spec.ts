import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type Redis from 'ioredis';
import { DashboardWidgetKey, UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { ensureFeeStructure } from '@test/helpers/fee-fixture.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import {
  SEED_TENANT_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/** E2E for `GET /dashboard/widgets/committee-finance` (#1890). */

const API = '/api/v1';
const URL = `${API}/dashboard/widgets/committee-finance`;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000189000a1';
const ROLES = Object.values(UserRole);
// None of these may appear as a key anywhere in the body.
const PII_KEYS = [
  'id',
  'full_name',
  'student_name',
  'guardian_name',
  'name',
  'phone',
  'email',
  'registration_number',
  'roll_number',
  'address',
  'invoice_number',
  'collector_name',
  'transaction_reference',
];

function keysDeep(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(keysDeep);
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [k, ...keysDeep(x)]);
  return [];
}

describe('GET /dashboard/widgets/committee-finance', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let token: string;

  const login = async () =>
    (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;

  const call = (role: UserRole, tenantId: string | null = SEED_TENANT_ID, bearer = token) => {
    const req = supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${bearer}`)
      .set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };

  const clearCache = () =>
    redis.del(`tenant:${SEED_TENANT_ID}:dash:${DashboardWidgetKey.COMMITTEE_FINANCE}:school`);

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
    for (const role of ROLES) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'committee-finance-other', 'committee-finance-other-e2e', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );
    token = await login();
  }, 120000);

  afterAll(async () => {
    await clearCache();
    await app.close();
  });

  afterEach(() => vi.useRealTimers());

  describe('D46 role matrix (one it per role)', () => {
    it('catalogue roles are exactly COMMITTEE, ADMIN, EXECUTIVE', () => {
      expect([...WIDGET_CATALOGUE['committee-finance'].roles].sort()).toEqual(
        [UserRole.COMMITTEE, UserRole.ADMIN, UserRole.EXECUTIVE].sort(),
      );
    });

    it('200 for ADMIN with exactly the DTO keys', async () => {
      await clearCache();
      const res = await call(UserRole.ADMIN).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['current_month', 'months', 'year_outstanding']);
    });
    it('200 for EXECUTIVE', async () => {
      await call(UserRole.EXECUTIVE).expect(200);
    });
    it('200 for COMMITTEE', async () => {
      await call(UserRole.COMMITTEE).expect(200);
    });
    it('403 for ACCOUNTANT (finance staff, but not a committee widget)', async () => {
      // Refused by permission (no COMMITTEE_REPORT_READ) before the role guard.
      await call(UserRole.ACCOUNTANT).expect(403);
    });
    it('403 for TEACHER', async () => {
      await call(UserRole.TEACHER).expect(403);
    });
    it('403 for OFFICE_STAFF', async () => {
      await call(UserRole.OFFICE_STAFF).expect(403);
    });
    it('403 for EXAM_CONTROLLER', async () => {
      await call(UserRole.EXAM_CONTROLLER).expect(403);
    });
    it('403 for PARENT', async () => {
      await call(UserRole.PARENT).expect(403);
    });
    it('403 for STUDENT', async () => {
      await call(UserRole.STUDENT).expect(403);
    });
  });

  describe('tenant header', () => {
    it('rejects a missing X-Tenant-ID', async () => {
      const res = await call(UserRole.ADMIN, null);
      expect([400, 401, 403]).toContain(res.status);
    });
    it('rejects a malformed X-Tenant-ID', async () => {
      const res = await call(UserRole.ADMIN, 'not-a-uuid');
      expect([400, 401, 403]).toContain(res.status);
    });
    it("a school A caller with school B's header never sees B's data", async () => {
      const res = await call(UserRole.ADMIN, OTHER_TENANT_ID);
      expect([401, 403]).toContain(res.status);
      expect(res.body).not.toHaveProperty('months');
    });
  });

  describe('COMMITTEE never reaches the collections report', () => {
    it.each(['/reports/collections', '/reports/collections.csv'])('403 on GET %s', async (p) => {
      await supertest(app.getHttpServer())
        .get(`${API}${p}`)
        .query({ from: '2026-10-01', to: '2026-10-07' })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', SEED_TENANT_ID)
        .set('X-Role', UserRole.COMMITTEE)
        .expect(403);
    });
  });

  describe('figures and no-PII (frozen clock)', () => {
    it('serves the series, the Jan..current months and carries no person field', async () => {
      const [{ id: studentId }] = await dataSource.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, date_of_birth, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
         VALUES ('Committee Finance Student', 'CFE-E2E-1', 1, $1, '2010-01-01', 'SMS', 'ACTIVE', $2, NOW(), NOW()) RETURNING id`,
        [SEED_SECTION_1_ID, SEED_TENANT_ID],
      );
      const structureId = await ensureFeeStructure(dataSource);
      const [year] = await dataSource.query(
        `SELECT to_char(start_date,'YYYY-MM-DD') AS s, to_char(end_date,'YYYY-MM-DD') AS e, is_current AS c FROM academic_years WHERE id = $1`,
        [SEED_ACADEMIC_YEAR_ID],
      );
      await dataSource.query(
        `UPDATE academic_years SET start_date = '2033-01-01', end_date = '2033-12-31', is_current = true WHERE id = $1`,
        [SEED_ACADEMIC_YEAR_ID],
      );
      await dataSource.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, standing_discount_amount, status, created_at, updated_at)
         VALUES ($1, $2, $3, '2033-02-01', 1000, 400, 100, 100, 'PARTIALLY_PAID', NOW(), NOW()),
                ($1, $2, $3, '2033-03-01', 500, 500, 0, 0, 'PAID', NOW(), NOW())`,
        [studentId, SEED_ACADEMIC_YEAR_ID, structureId],
      );
      await dataSource.query(
        `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id, created_at, updated_at)
         VALUES ($1, 500, 'CASH', 'SUCCESS', '2033-03-02T05:00:00Z', $2, NOW(), NOW())`,
        [studentId, SEED_TENANT_ID],
      );
      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2033-03-10T06:00:00Z'));
        await clearCache();
        const res = await call(UserRole.COMMITTEE, SEED_TENANT_ID, await login()).expect(200);
        expect(res.body.months).toEqual([
          { month: '2033-01', billed: 0, paid: 0, outstanding: 0 },
          { month: '2033-02', billed: 900, paid: 400, outstanding: 500 },
          { month: '2033-03', billed: 500, paid: 500, outstanding: 0 },
        ]);
        expect(res.body.year_outstanding).toBe(500);
        expect(res.body.current_month).toMatchObject({
          month: '2033-03',
          received: 500,
          billed_for_month: 500,
          received_pct: 100,
        });
        const keys = keysDeep(res.body);
        for (const k of keys) {
          expect(PII_KEYS, k).not.toContain(k);
          expect(k.endsWith('_id'), k).toBe(false);
        }
      } finally {
        await clearCache();
        await dataSource.query(`DELETE FROM payments WHERE student_id = $1`, [studentId]);
        await dataSource.query(`DELETE FROM student_fees WHERE student_id = $1`, [studentId]);
        await dataSource.query(`DELETE FROM students WHERE id = $1`, [studentId]);
        await dataSource.query(
          `UPDATE academic_years SET start_date = $2, end_date = $3, is_current = $4 WHERE id = $1`,
          [SEED_ACADEMIC_YEAR_ID, year.s, year.e, year.c],
        );
      }
    });
  });
});
