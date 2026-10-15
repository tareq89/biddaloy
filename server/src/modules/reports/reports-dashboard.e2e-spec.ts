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

/**
 * E2E for `GET /dashboard/widgets/collection-month` (#1849): D46 role matrix,
 * tenant gate, and the month / same-point maths under a frozen clock.
 */

const API = '/api/v1';
const URL = `${API}/dashboard/widgets/collection-month`;
const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000184900a1';
const ROLES = Object.values(UserRole);

describe('GET /dashboard/widgets/collection-month', () => {
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

  const call = (role: UserRole, tenantId = SEED_TENANT_ID, bearer = token) =>
    supertest(app.getHttpServer())
      .get(URL)
      .set('Authorization', `Bearer ${bearer}`)
      .set('X-Tenant-ID', tenantId)
      .set('X-Role', role);

  // The widget is cached for 60 s; clear it so each frozen-clock case recomputes.
  const clearCache = () =>
    redis.del(`tenant:${SEED_TENANT_ID}:dash:v1:${DashboardWidgetKey.COLLECTION_MONTH}:school`);

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
       VALUES ($1, 'collection-month-other', 'collection-month-other', NOW(), NOW())
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

  describe('D46 role matrix', () => {
    const allowed = WIDGET_CATALOGUE['collection-month'].roles;

    it('catalogue roles are exactly ADMIN, EXECUTIVE, ACCOUNTANT', () => {
      expect([...allowed].sort()).toEqual(
        [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT].sort(),
      );
    });

    it.each([UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT])('200 for %s', async (r) => {
      const res = await call(r).expect(200);
      expect(res.body).toHaveProperty('received');
      expect(res.body).toHaveProperty('billed_for_month');
    });

    it.each([
      UserRole.TEACHER,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
      UserRole.PARENT,
      UserRole.STUDENT,
    ])('403 for %s', async (r) => {
      await call(r).expect(403);
    });

    it("another tenant's X-Tenant-ID is refused (401/403, as the widget probe spec)", async () => {
      const res = await call(UserRole.ADMIN, OTHER_TENANT_ID);
      expect([401, 403]).toContain(res.status);
    });
  });

  // #1866: collection-today and collection-by-month share one role set.
  describe.each([
    {
      key: DashboardWidgetKey.COLLECTION_TODAY,
      keys: ['date', 'groups', 'net', 'payment_count', 'yesterday_same_time_net'],
    },
    {
      key: DashboardWidgetKey.COLLECTION_BY_MONTH,
      keys: [
        'month_to_date_net',
        'months',
        'previous_month_same_days_net',
        'year',
        'year_to_date_net',
      ],
    },
  ])('$key (#1866)', ({ key, keys }) => {
    const url = `${API}/dashboard/widgets/${key}`;
    const get = (role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
      const req = supertest(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Role', role);
      return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
    };
    const clear = () => redis.del(`tenant:${SEED_TENANT_ID}:dash:${key}:school`);

    afterAll(clear);

    it('catalogue roles are exactly ADMIN, EXECUTIVE, ACCOUNTANT', () => {
      expect([...WIDGET_CATALOGUE[key].roles].sort()).toEqual(
        [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT].sort(),
      );
    });

    it('200 for ADMIN with exactly the DTO keys', async () => {
      await clear();
      const res = await get(UserRole.ADMIN).expect(200);
      expect(Object.keys(res.body).sort()).toEqual(keys);
    });
    it('200 for EXECUTIVE', async () => {
      await get(UserRole.EXECUTIVE).expect(200);
    });
    it('200 for ACCOUNTANT', async () => {
      await get(UserRole.ACCOUNTANT).expect(200);
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
    it('403 for COMMITTEE', async () => {
      await get(UserRole.COMMITTEE).expect(403);
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
    it("a school A caller with school B's header never sees B's data", async () => {
      const res = await get(UserRole.ADMIN, OTHER_TENANT_ID);
      expect([401, 403]).toContain(res.status);
      expect(res.body).not.toHaveProperty('net');
      expect(res.body).not.toHaveProperty('months');
    });
  });

  describe('collection-today / collection-by-month figures (frozen clock)', () => {
    it('reports a payment made today and the Jan wrap', async () => {
      const [{ id: studentId }] = await dataSource.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, date_of_birth, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
         VALUES ('Collection Today Student', 'CT-E2E-1', 1, $1, '2010-01-01', 'SMS', 'ACTIVE', $2, NOW(), NOW()) RETURNING id`,
        [SEED_SECTION_1_ID, SEED_TENANT_ID],
      );
      await dataSource.query(
        `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id, created_at, updated_at)
         VALUES ($1, 400, 'BKASH', 'SUCCESS', '2032-01-14T03:00:00Z', $2, NOW(), NOW()),
                ($1, 900, 'CASH', 'FAILED', '2032-01-14T03:30:00Z', $2, NOW(), NOW()),
                ($1, 250, 'CASH', 'SUCCESS', '2031-12-10T05:00:00Z', $2, NOW(), NOW())`,
        [studentId, SEED_TENANT_ID],
      );
      const clearBoth = () =>
        Promise.all(
          [DashboardWidgetKey.COLLECTION_TODAY, DashboardWidgetKey.COLLECTION_BY_MONTH].map((k) =>
            redis.del(`tenant:${SEED_TENANT_ID}:dash:${k}:school`),
          ),
        );
      try {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2032-01-14T06:00:00Z')); // 12:00 Dhaka, 14 Jan
        await clearBoth();
        const bearer = await login();
        const get = (k: string) =>
          supertest(app.getHttpServer())
            .get(`${API}/dashboard/widgets/${k}`)
            .set('Authorization', `Bearer ${bearer}`)
            .set('X-Tenant-ID', SEED_TENANT_ID)
            .set('X-Role', UserRole.ADMIN)
            .expect(200);
        const today = (await get('collection-today')).body;
        expect(today).toMatchObject({ date: '2032-01-14', net: 400, payment_count: 1 });
        expect(today.groups[1]).toMatchObject({ group: 'BKASH', net: 400 });
        const month = (await get('collection-by-month')).body;
        expect(month).toMatchObject({
          year: 2032,
          year_to_date_net: 400,
          month_to_date_net: 400,
          // 1-14 Dec 2031: the 10 Dec payment.
          previous_month_same_days_net: 250,
        });
        expect(month.months[1].net).toBeNull();
      } finally {
        await clearBoth();
        await dataSource.query(`DELETE FROM payments WHERE student_id = $1`, [studentId]);
        await dataSource.query(`DELETE FROM students WHERE id = $1`, [studentId]);
      }
    });
  });

  describe('month maths (frozen clock, Dhaka day)', () => {
    async function at(iso: string) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(iso));
      await clearCache();
      // Log in under the frozen clock so the JWT is valid.
      const res = await call(UserRole.ADMIN, SEED_TENANT_ID, await login()).expect(200);
      return res.body;
    }

    it('18:00Z on 31 Oct is already 1 Nov in Dhaka: month 2031-11, last month as_of 2031-10-01', async () => {
      const body = await at('2031-10-31T18:00:00Z');
      expect(body.month).toBe('2031-11');
      expect(body.as_of).toBe('2031-11-01');
      expect(body.last_month_same_point.as_of).toBe('2031-10-01');
    });

    it('31 Oct clamps last month to 30 Sep', async () => {
      const body = await at('2031-10-31T06:00:00Z');
      expect(body.month).toBe('2031-10');
      expect(body.last_month_same_point.as_of).toBe('2031-09-30');
    });

    it('computes received, billed, pct and a null empty last year', async () => {
      const [{ id: studentId }] = await dataSource.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, date_of_birth, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
         VALUES ('Collection Month Student', 'CM-E2E-1', 1, $1, '2010-01-01', 'SMS', 'ACTIVE', $2, NOW(), NOW()) RETURNING id`,
        [SEED_SECTION_1_ID, SEED_TENANT_ID],
      );
      const structureId = await ensureFeeStructure(dataSource);
      await dataSource.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, standing_discount_amount, status, created_at, updated_at)
         VALUES ($1, $2, $3, '2031-10-01', 2000, 0, 500, 500, 'PENDING', NOW(), NOW()),
                ($1, $2, $3, '2031-09-01', 1000, 0, 0, 0, 'PENDING', NOW(), NOW())`,
        [studentId, SEED_ACADEMIC_YEAR_ID, structureId],
      );
      await dataSource.query(
        `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id, created_at, updated_at)
         VALUES ($1, 750, 'CASH', 'SUCCESS', '2031-10-05T05:00:00Z', $2, NOW(), NOW()),
                ($1, 300, 'CASH', 'SUCCESS', '2031-09-10T05:00:00Z', $2, NOW(), NOW())`,
        [studentId, SEED_TENANT_ID],
      );
      try {
        const body = await at('2031-10-20T06:00:00Z');
        expect(body).toMatchObject({
          month: '2031-10',
          as_of: '2031-10-20',
          received: 750,
          billed_for_month: 1500,
          received_pct: 50,
          last_month_same_point: {
            as_of: '2031-09-20',
            received: 300,
            billed_for_month: 1000,
            received_pct: 30,
          },
          last_year_same_point: null,
        });
      } finally {
        await dataSource.query(`DELETE FROM payments WHERE student_id = $1`, [studentId]);
        await dataSource.query(`DELETE FROM student_fees WHERE student_id = $1`, [studentId]);
        await dataSource.query(`DELETE FROM students WHERE id = $1`, [studentId]);
      }
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
