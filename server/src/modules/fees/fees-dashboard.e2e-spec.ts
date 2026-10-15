import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
 * E2E for the five accountant fees widgets (#1867, #1868): the D46 role
 * matrix per route, the tenant gate, tenant isolation of the figures, and
 * the response keys against the DTOs.
 */

const API = '/api/v1';
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000001867001';
const STUDENT_A_REG = 'FD-E2E-A';
const STUDENT_B_REG = 'FD-E2E-B';
const ALL_ROLES = Object.values(UserRole);

const ROUTES = [
  {
    key: DashboardWidgetKey.DUES_AGEING,
    allowed: [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT],
    keys: ['as_of', 'buckets', 'total_due'],
  },
  {
    key: DashboardWidgetKey.DUES_BY_CLASS,
    allowed: [UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT],
    keys: ['classes', 'total_due'],
  },
  {
    key: DashboardWidgetKey.REMINDERS_PENDING,
    allowed: [UserRole.ADMIN, UserRole.ACCOUNTANT],
    keys: ['guardian_count', 'oldest_threshold_date', 'student_count'],
  },
  {
    key: DashboardWidgetKey.FEE_GENERATION_STATUS,
    allowed: [UserRole.ADMIN, UserRole.ACCOUNTANT],
    keys: [
      'batch_count',
      'bill_count',
      'first_generated_at',
      'generated',
      'next_scheduled_run',
      'period',
    ],
  },
  {
    key: DashboardWidgetKey.RECENT_PAYMENTS,
    allowed: [UserRole.ADMIN, UserRole.ACCOUNTANT],
    keys: ['items', 'total_of_shown'],
  },
];

describe('fees dashboard widgets', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redis: Redis;
  let token: string;
  const created = { students: [] as string[] };

  const url = (key: string) => `${API}/dashboard/widgets/${key}`;

  const call = (key: string, role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = supertest(app.getHttpServer())
      .get(url(key))
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', role);
    return tenantId === null ? req : req.set('X-Tenant-ID', tenantId);
  };

  const clearCache = () =>
    Promise.all(ROUTES.map((r) => redis.del(`tenant:${SEED_TENANT_ID}:dash:${r.key}:school`)));

  async function insertStudent(tenantId: string, reg: string, roll: number): Promise<string> {
    const [{ id }] = await dataSource.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, date_of_birth, preferred_communication, enrollment_status, tenant_id, created_at, updated_at)
       VALUES ($1, $1, $2, $3, '2010-01-01', 'SMS', 'ACTIVE', $4, NOW(), NOW()) RETURNING id`,
      [reg, roll, SEED_SECTION_1_ID, tenantId],
    );
    created.students.push(id);
    return id;
  }

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

    for (const role of ALL_ROLES) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'fees-dashboard-other', 'fees-dashboard-other', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
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
    await dataSource.query(`DELETE FROM payments WHERE student_id = ANY($1)`, [created.students]);
    await dataSource.query(`DELETE FROM student_fees WHERE student_id = ANY($1)`, [
      created.students,
    ]);
    await dataSource.query(`DELETE FROM students WHERE id = ANY($1)`, [created.students]);
    await clearCache();
    await app.close();
  });

  describe('D46 role matrix', () => {
    it('the catalogue roles are the ones this suite asserts', () => {
      for (const r of ROUTES) {
        expect([...WIDGET_CATALOGUE[r.key].roles].sort()).toEqual([...r.allowed].sort());
      }
    });

    // dues-ageing
    it.each([UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT])(
      'dues-ageing: 200 for %s',
      async (role) => {
        await call('dues-ageing', role).expect(200);
      },
    );
    it.each([
      UserRole.TEACHER,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
      UserRole.PARENT,
      UserRole.STUDENT,
    ])('dues-ageing: 403 for %s', async (role) => {
      await call('dues-ageing', role).expect(403);
    });

    // dues-by-class
    it.each([UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.ACCOUNTANT])(
      'dues-by-class: 200 for %s',
      async (role) => {
        await call('dues-by-class', role).expect(200);
      },
    );
    it.each([
      UserRole.TEACHER,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
      UserRole.COMMITTEE,
      UserRole.PARENT,
      UserRole.STUDENT,
    ])('dues-by-class: 403 for %s', async (role) => {
      await call('dues-by-class', role).expect(403);
    });

    // reminders-pending, fee-generation-status, recent-payments: ADMIN + ACCOUNTANT only
    for (const key of ['reminders-pending', 'fee-generation-status', 'recent-payments']) {
      it.each([UserRole.ADMIN, UserRole.ACCOUNTANT])(`${key}: 200 for %s`, async (role) => {
        await call(key, role).expect(200);
      });
      it.each([
        UserRole.EXECUTIVE,
        UserRole.TEACHER,
        UserRole.OFFICE_STAFF,
        UserRole.EXAM_CONTROLLER,
        UserRole.COMMITTEE,
        UserRole.PARENT,
        UserRole.STUDENT,
      ])(`${key}: 403 for %s`, async (role) => {
        await call(key, role).expect(403);
      });
    }
  });

  describe('tenant gate', () => {
    it.each(ROUTES.map((r) => r.key))('%s: missing X-Tenant-ID is rejected', async (key) => {
      const res = await call(key, UserRole.ADMIN, null);
      expect([400, 401, 403]).toContain(res.status);
    });

    it.each(ROUTES.map((r) => r.key))('%s: invalid X-Tenant-ID is rejected', async (key) => {
      const res = await call(key, UserRole.ADMIN, 'not-a-uuid');
      expect([400, 401, 403]).toContain(res.status);
    });

    it.each(ROUTES.map((r) => r.key))(
      "%s: a caller of school A with school B's header is refused",
      async (key) => {
        const res = await call(key, UserRole.ADMIN, OTHER_TENANT_ID);
        expect([401, 403]).toContain(res.status);
      },
    );
  });

  describe('figures', () => {
    it('response keys equal the DTO; school A never sees school B data; figures reconcile with SQL', async () => {
      const structureId = await ensureFeeStructure(dataSource);
      const a = await insertStudent(SEED_TENANT_ID, STUDENT_A_REG, 18671);
      const b = await insertStudent(OTHER_TENANT_ID, STUDENT_B_REG, 18672);
      // A: 1000 due 45 days ago (31_60) with 300 paid and 100 discount -> balance 600.
      // B: 5000 due 100 days ago; must never reach school A.
      await dataSource.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, total_amount, paid_amount, discount_amount, standing_discount_amount, status, due_date, reminder_threshold_date, created_at, updated_at)
         VALUES ($1, $3, $4, '2031-01-01', 1000, 300, 100, 100, 'PARTIALLY_PAID', CURRENT_DATE - 45, CURRENT_DATE - 5, NOW(), NOW()),
                ($2, $3, $4, '2031-01-01', 5000, 0, 0, 0, 'PENDING', CURRENT_DATE - 100, CURRENT_DATE - 50, NOW(), NOW())`,
        [a, b, SEED_ACADEMIC_YEAR_ID, structureId],
      );
      const [{ id: payA }] = await dataSource.query(
        `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id, created_at, updated_at)
         VALUES ($1, 300, 'CASH', 'SUCCESS', NOW() + interval '2 hours', $2, NOW(), NOW()) RETURNING id`,
        [a, SEED_TENANT_ID],
      );
      const [{ id: payB }] = await dataSource.query(
        `INSERT INTO payments (student_id, total_amount, payment_method, payment_status, payment_date, tenant_id, created_at, updated_at)
         VALUES ($1, 999, 'CASH', 'SUCCESS', NOW() + interval '1 minute', $2, NOW(), NOW()) RETURNING id`,
        [b, OTHER_TENANT_ID],
      );
      await clearCache();

      const sqlTotal = async (tenant: string) =>
        Number(
          (
            await dataSource.query(
              `SELECT COALESCE(SUM(sf.total_amount - sf.paid_amount - sf.discount_amount), 0) AS t
               FROM student_fees sf JOIN students s ON s.id = sf.student_id
               WHERE s.tenant_id = $1 AND s.deleted_at IS NULL AND sf.deleted_at IS NULL
                 AND sf.status IN ('PENDING', 'PARTIALLY_PAID')`,
              [tenant],
            )
          )[0].t,
        );
      const totalA = await sqlTotal(SEED_TENANT_ID);
      expect(await sqlTotal(OTHER_TENANT_ID)).toBe(5000); // B's fee exists, so isolation is real

      for (const r of ROUTES) {
        const res = await call(r.key, UserRole.ADMIN).expect(200);
        expect(Object.keys(res.body).sort(), r.key).toEqual(r.keys);
      }

      const ageing = (await call('dues-ageing', UserRole.ADMIN).expect(200)).body;
      expect(ageing.total_due).toBe(totalA);
      expect(ageing.buckets.map((x: { bucket: string }) => x.bucket)).toEqual([
        '0_30',
        '31_60',
        '60_PLUS',
      ]);
      expect(ageing.buckets[1].amount).toBeGreaterThanOrEqual(600);

      const byClass = (await call('dues-by-class', UserRole.ADMIN).expect(200)).body;
      expect(byClass.total_due).toBe(totalA);

      const rem = (await call('reminders-pending', UserRole.ADMIN).expect(200)).body;
      expect(rem.student_count).toBeGreaterThanOrEqual(1);
      expect(rem.oldest_threshold_date).not.toBe(null);

      const recent = (await call('recent-payments', UserRole.ADMIN).expect(200)).body;
      const ids = recent.items.map((i: { payment_id: string }) => i.payment_id);
      expect(ids).toContain(payA);
      expect(ids).not.toContain(payB); // B's newer payment never leaks
      expect(typeof recent.items[0].amount).toBe('number');
    });
  });
});
