import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../app.module';
import { DataSource } from 'typeorm';
import { UserRole } from '@beton-boi/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';

/**
 * E2E tests for the Fee Dues & Flagging API (issue #15).
 *
 * Tests RBAC, tenant isolation, and the end-to-end shape of
 * GET /fees/dues and GET /fees/dues/flagged.
 */

describe('Fee Dues E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;
  let studentSeq = 0;

  async function createStudent(): Promise<string> {
    studentSeq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING id`,
      [`Dues Student ${studentSeq}`, `REG-DUES-E2E-${String(studentSeq).padStart(4, '0')}`, studentSeq, SEED_SECTION_1_ID, TENANT_ID, '2010-01-01', 'SMS', 'ACTIVE'],
    );
    return res[0].id;
  }

  async function createFee(
    studentId: string,
    overrides: { status?: string; reminder_threshold_date?: string | null; month?: number } = {},
  ): Promise<string> {
    const res = await dataSource.query(
      `INSERT INTO student_fees (id, student_id, academic_year_id, month, year, total_amount, paid_amount, discount_amount, status, reminder_threshold_date, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, 0, 0, $6, $7, NOW(), NOW())
       RETURNING id`,
      [
        studentId,
        SEED_ACADEMIC_YEAR_ID,
        overrides.month ?? 5,
        2026,
        1000,
        overrides.status ?? 'PENDING',
        overrides.reminder_threshold_date ?? null,
      ],
    );
    return res[0].id;
  }

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.ACCOUNTANT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.STUDENT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /fees/dues', () => {
    it('returns students with pending/overdue fees for ADMIN role', async () => {
      const studentId = await createStudent();
      await createFee(studentId, { status: 'PENDING' });

      const res = await supertest(app.getHttpServer())
        .get('/fees/dues')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.data.some((d: any) => d.student_id === studentId)).toBe(true);
      const entry = res.body.data.find((d: any) => d.student_id === studentId);
      expect(entry.total_due).toBe(1000);
      expect(Array.isArray(entry.dues)).toBe(true);
    });

    it('allows TEACHER role (read access)', async () => {
      await supertest(app.getHttpServer())
        .get('/fees/dues')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);
    });

    it('returns 401 for STUDENT role', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/fees/dues')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);

      expect(res.body.message).toContain('Requires one of roles');
    });

    it('supports sorting by due amount', async () => {
      const s1 = await createStudent();
      const s2 = await createStudent();
      await createFee(s1, { status: 'PENDING' });
      const bigFeeStudentId = s2;
      await dataSource.query(
        `INSERT INTO student_fees (id, student_id, academic_year_id, month, year, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, 6, 2026, 5000, 0, 0, 'PENDING', NOW(), NOW())`,
        [bigFeeStudentId, SEED_ACADEMIC_YEAR_ID],
      );

      const res = await supertest(app.getHttpServer())
        .get('/fees/dues')
        .query({ sort_by: 'due_amount', sort_order: 'DESC', limit: 100 })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const ids = res.body.data.map((d: any) => d.student_id);
      expect(ids.indexOf(bigFeeStudentId)).toBeLessThan(ids.indexOf(s1));
    });

    it('returns 400 for an invalid status filter', async () => {
      await supertest(app.getHttpServer())
        .get('/fees/dues')
        .query({ status: 'PAID' })
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(400);
    });
  });

  describe('GET /fees/dues/flagged', () => {
    it('returns students past their reminder_threshold_date with guardian contact info', async () => {
      const studentId = await createStudent();
      const guardianRes = await dataSource.query(
        `INSERT INTO guardians (id, full_name, relationship, phone, email, preferred_communication, is_primary_contact, tenant_id, created_at, updated_at)
         VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING id`,
        ['Flagged Guardian', 'Father', '+8801799999999', 'guardian@example.com', 'SMS', true, TENANT_ID],
      );
      await dataSource.query(
        'INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)',
        [studentId, guardianRes[0].id],
      );
      await createFee(studentId, { reminder_threshold_date: '2020-01-01' });

      const res = await supertest(app.getHttpServer())
        .get('/fees/dues/flagged')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      const entry = res.body.data.find((d: any) => d.student_id === studentId);
      expect(entry).toBeDefined();
      expect(entry.guardians[0]).toMatchObject({ full_name: 'Flagged Guardian', phone: '+8801799999999' });
    });

    it('excludes students not yet past their reminder_threshold_date', async () => {
      const studentId = await createStudent();
      await createFee(studentId, { reminder_threshold_date: '2099-01-01' });

      const res = await supertest(app.getHttpServer())
        .get('/fees/dues/flagged')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(200);

      expect(res.body.data.some((d: any) => d.student_id === studentId)).toBe(false);
    });

    it('returns 401 for STUDENT role', async () => {
      await supertest(app.getHttpServer())
        .get('/fees/dues/flagged')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);
    });
  });
});
