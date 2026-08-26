import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { DataSource } from 'typeorm';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { UserRole } from '@biddaloy/shared';

/**
 * E2E tests for the bulk-reminder read/preview endpoints added for the
 * Communications UI (issue #178, part a):
 *
 *   GET  /communications/reminder/bulk           — Reminder History list
 *   POST /communications/reminder/bulk/preview   — mandatory review step
 *   GET  /communications/reminder/bulk/:id/logs  — per-recipient status
 *
 * Focus: tenant isolation, the 500-student cap, soft-deleted students,
 * and that preview writes absolutely nothing.
 */

describe('Bulk Reminder Read/Preview E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  // An authenticated caller inside the tenant whose role is NOT on
  // @Roles(ADMIN, ACCOUNTANT, EXECUTIVE) — so RolesGuard, not "no token",
  // is what rejects them.
  let teacherToken: string;
  // A real ADMIN of the *other* school, for the cross-tenant case.
  let otherTenantAdminToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const TEACHER_USER_ID = '00000000-0000-4000-8000-00000000b0b1';
  const TEACHER_EMAIL = 'teacher@bulk-reminder-e2e.example';
  const OTHER_ADMIN_USER_ID = '00000000-0000-4000-8000-00000000b0b2';
  const OTHER_ADMIN_EMAIL = 'admin@bulk-reminder-e2e-other.example';
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-00000000b0b0';
  let seq = 0;

  async function createStudent(overrides: { deleted?: boolean } = {}): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, deleted_at, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING id`,
      [
        `Reminder Student ${seq}`,
        `REG-REM-E2E-${String(seq).padStart(4, '0')}`,
        seq,
        SEED_SECTION_1_ID,
        TENANT_ID,
        '2010-01-01',
        'SMS',
        'ACTIVE',
        overrides.deleted ? new Date() : null,
      ],
    );
    return res[0].id;
  }

  async function createGuardian(
    studentId: string,
    overrides: { phone?: string | null; is_primary?: boolean; name?: string } = {},
  ): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO guardians (id, full_name, relationship, phone, preferred_communication, is_primary_contact, tenant_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id`,
      [
        overrides.name ?? `Reminder Guardian ${seq}`,
        'FATHER',
        overrides.phone === undefined ? '01712345678' : overrides.phone,
        'SMS',
        overrides.is_primary ?? true,
        TENANT_ID,
      ],
    );
    const guardianId = res[0].id;
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [studentId, guardianId],
    );
    return guardianId;
  }

  async function createFee(studentId: string): Promise<void> {
    await dataSource.query(
      `INSERT INTO student_fees (id, student_id, academic_year_id, month, year, total_amount, paid_amount, discount_amount, status, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 5, 2026, 1000, 0, 0, 'PENDING', NOW(), NOW())`,
      [studentId, SEED_ACADEMIC_YEAR_ID],
    );
  }

  async function createBatch(
    tenantId: string,
    overrides: { name?: string; created_at?: string } = {},
  ): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO reminder_batches (id, tenant_id, batch_name, status, total_recipients, message_template, initiated_by_user_id, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'COMPLETED', 1, 'Dear {{guardian_name}}', $3, $4, NOW())
       RETURNING id`,
      [
        tenantId,
        overrides.name ?? `Batch ${seq}`,
        SEED_ADMIN_USER_ID,
        overrides.created_at ?? new Date().toISOString(),
      ],
    );
    return res[0].id;
  }

  async function createBatchLog(
    batchId: string,
    tenantId: string,
    overrides: { status?: string; metadata?: object | null } = {},
  ): Promise<string> {
    seq += 1;
    const res = await dataSource.query(
      `INSERT INTO communication_logs (id, tenant_id, reminder_batch_id, medium, recipient_address, recipient_name, message_body, status, trigger, created_at, updated_at)
       VALUES (DEFAULT, $1, $2, 'SMS', '01712345678', $3, 'Dear guardian', $4, 'BULK_REMINDER', NOW(), NOW())
       RETURNING id`,
      [tenantId, batchId, `Log Recipient ${seq}`, overrides.status ?? 'SENT'],
    );
    if (overrides.metadata !== undefined) {
      await dataSource.query(`UPDATE communication_logs SET metadata = $1 WHERE id = $2`, [
        JSON.stringify(overrides.metadata),
        res[0].id,
      ]);
    }
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
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // A second school, so "Tenant A cannot read Tenant B's batches" is a
    // real cross-tenant assertion rather than a mock. Seeded once — the
    // per-test truncation never touches the schools table.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other School', 'other-school-reminders-e2e', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID],
    );

    // A TEACHER membership inside the caller tenant: authenticated, but off
    // the @Roles list every bulk-reminder route carries.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Reminder E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    // An ADMIN who belongs only to the other school — the right role, the
    // wrong tenant.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Reminder E2E Other Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_USER_ID, OTHER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;

    const teacherLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: TEACHER_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    teacherToken = teacherLoginRes.body.access_token;

    const otherAdminLoginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: OTHER_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    otherTenantAdminToken = otherAdminLoginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /communications/reminder/bulk', () => {
    it('lists only the caller tenant batches, newest first, with pagination metadata', async () => {
      await createBatch(TENANT_ID, { name: 'Older', created_at: '2026-03-01T00:00:00Z' });
      await createBatch(TENANT_ID, { name: 'Newer', created_at: '2026-04-01T00:00:00Z' });
      await createBatch(OTHER_TENANT_ID, { name: 'Foreign' });

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/communications/reminder/bulk')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
      expect(res.body.totalPages).toBe(1);
      expect(res.body.data.map((b: any) => b.batch_name)).toEqual(['Newer', 'Older']);
      // List rows must not carry each batch's (potentially huge) skip list.
      expect(res.body.data[0]).not.toHaveProperty('skipped');
    });

    it('paginates', async () => {
      await createBatch(TENANT_ID, { created_at: '2026-03-01T00:00:00Z' });
      await createBatch(TENANT_ID, { created_at: '2026-04-01T00:00:00Z' });
      await createBatch(TENANT_ID, { created_at: '2026-05-01T00:00:00Z' });

      const res = await supertest(app.getHttpServer())
        .get('/api/v1/communications/reminder/bulk?page=2&limit=2')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.page).toBe(2);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.totalPages).toBe(2);
    });

    it('rejects an out-of-range limit', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/communications/reminder/bulk?limit=500')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(400);
    });

    it('requires the X-Tenant-ID header', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/communications/reminder/bulk')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });

  describe('POST /communications/reminder/bulk/preview', () => {
    it('returns the rendered recipients and skipped guardians without writing anything', async () => {
      const studentId = await createStudent();
      await createGuardian(studentId, { name: 'Karim Uddin' });
      await createGuardian(studentId, { name: 'Salma Begum', phone: null });
      await createFee(studentId);

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          student_ids: [studentId],
          message_template: 'Dear {{guardian_name}}, {{student_name}} owes {{due_amount}}.',
        })
        .expect(200);

      expect(res.body.total_students).toBe(1);
      expect(res.body.recipients_count).toBe(1);
      expect(res.body.skipped_count).toBe(1);

      const student = res.body.students[0];
      expect(student.student_id).toBe(studentId);
      expect(student.recipients[0]).toMatchObject({
        guardian_name: 'Karim Uddin',
        medium: 'SMS',
        address: '01712345678',
        subject: null,
      });
      expect(student.recipients[0].message_body).toContain('Dear Karim Uddin');
      expect(student.recipients[0].message_body).toContain('owes 1,000.00');
      expect(student.skipped[0]).toMatchObject({
        guardian_name: 'Salma Begum',
        reason: 'guardian_has_no_address_for_preferred_medium',
      });

      // Preview must be side-effect free — no batch, no logs, no jobs.
      const batches = await dataSource.query(`SELECT COUNT(*)::int AS n FROM reminder_batches`);
      const logs = await dataSource.query(`SELECT COUNT(*)::int AS n FROM communication_logs`);
      expect(batches[0].n).toBe(0);
      expect(logs[0].n).toBe(0);
    });

    it('rejects more than 500 students in one batch', async () => {
      const ids = Array.from({ length: 501 }, () => randomUUID());

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ student_ids: ids, message_template: 'Hi {{guardian_name}}' })
        .expect(400);

      expect(JSON.stringify(res.body.message)).toContain('500');
    });

    // Fails closed: `[]` means "no channel at all", and the resolver would
    // otherwise read it the same as an omitted field — "any channel" — and
    // fan a send out to everybody.
    it('rejects an explicitly empty mediums list rather than defaulting to every channel', async () => {
      const studentId = await createStudent();
      await createGuardian(studentId);
      await createFee(studentId);

      await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({
          student_ids: [studentId],
          message_template: 'Dear {{guardian_name}}',
          mediums: [],
        })
        .expect(400);
    });

    it('rejects an unsupported template placeholder, naming it', async () => {
      const studentId = await createStudent();

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ student_ids: [studentId], message_template: 'Hi {{parent}}' })
        .expect(400);

      expect(res.body.message).toContain('Unsupported template placeholder(s): parent');
    });

    it('404s for a student belonging to another tenant', async () => {
      // Tenant isolation: an attacker guessing another school's student id
      // must get "not found", never that student's guardians and dues.
      const foreignStudent = await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, date_of_birth, preferred_communication, enrollment_status, created_at, updated_at)
         VALUES (DEFAULT, 'Foreign Student', 'REG-REM-FOREIGN-1', 9001, $2, $1, '2010-01-01', 'SMS', 'ACTIVE', NOW(), NOW())
         RETURNING id`,
        [OTHER_TENANT_ID, SEED_SECTION_1_ID],
      );

      await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ student_ids: [foreignStudent[0].id], message_template: 'Hi {{guardian_name}}' })
        .expect(404);
    });

    it('404s for a soft-deleted student', async () => {
      const deletedId = await createStudent({ deleted: true });

      await supertest(app.getHttpServer())
        .post('/api/v1/communications/reminder/bulk/preview')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ student_ids: [deletedId], message_template: 'Hi {{guardian_name}}' })
        .expect(404);
    });
  });

  describe('GET /communications/reminder/bulk/:id/logs', () => {
    it('returns only the batch own logs, with the failure reason surfaced', async () => {
      const batchId = await createBatch(TENANT_ID);
      const otherBatchId = await createBatch(TENANT_ID);
      await createBatchLog(batchId, TENANT_ID, {
        status: 'FAILED',
        metadata: { error: 'No provider registered for medium "SMS"' },
      });
      await createBatchLog(otherBatchId, TENANT_ID);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/communications/reminder/bulk/${batchId}/logs`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({
        status: 'FAILED',
        error: 'No provider registered for medium "SMS"',
      });
      // Row list is a status table, not a message dump.
      expect(res.body.data[0]).not.toHaveProperty('message_body');
    });

    it('paginates the logs', async () => {
      const batchId = await createBatch(TENANT_ID);
      await createBatchLog(batchId, TENANT_ID);
      await createBatchLog(batchId, TENANT_ID);
      await createBatchLog(batchId, TENANT_ID);

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/communications/reminder/bulk/${batchId}/logs?page=2&limit=2`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.totalPages).toBe(2);
    });

    it('404s for a batch belonging to another tenant', async () => {
      const foreignBatchId = await createBatch(OTHER_TENANT_ID);
      await createBatchLog(foreignBatchId, OTHER_TENANT_ID);

      await supertest(app.getHttpServer())
        .get(`/api/v1/communications/reminder/bulk/${foreignBatchId}/logs`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });

    it('404s for a batch that does not exist', async () => {
      await supertest(app.getHttpServer())
        .get(`/api/v1/communications/reminder/bulk/${randomUUID()}/logs`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });
  // Mandatory per server/CLAUDE.md: every route is exercised by a role the
  // @Roles list excludes, and by a tenant header the caller has no
  // membership in. RolesGuard answers a disallowed role with 401 (see
  // context.guard.ts's own comment), so these pin the documented behavior
  // rather than assuming 403.
  describe('authorization and tenant scoping', () => {
    const routes: Array<{ name: string; call: (t: string, tenant: string) => supertest.Test }> = [
      {
        name: 'GET /communications/reminder/bulk',
        call: (t, tenant) =>
          supertest(app.getHttpServer())
            .get('/api/v1/communications/reminder/bulk')
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant),
      },
      {
        name: 'POST /communications/reminder/bulk/preview',
        call: (t, tenant) =>
          supertest(app.getHttpServer())
            .post('/api/v1/communications/reminder/bulk/preview')
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant)
            .send({ student_ids: [randomUUID()], message_template: 'Dear {{guardian_name}}' }),
      },
      {
        name: 'GET /communications/reminder/bulk/:id/logs',
        call: (t, tenant) =>
          supertest(app.getHttpServer())
            .get(`/api/v1/communications/reminder/bulk/${randomUUID()}/logs`)
            .set('Authorization', `Bearer ${t}`)
            .set('X-Tenant-ID', tenant),
      },
    ];

    for (const route of routes) {
      it(`${route.name} rejects a TEACHER — a role outside its @Roles list`, async () => {
        await route.call(teacherToken, TENANT_ID).expect(401);
      });

      it(`${route.name} rejects an X-Tenant-ID the caller has no membership in`, async () => {
        // Right role, wrong school: an ADMIN of the other tenant cannot
        // borrow this tenant's header to read its reminders. Tenant here is
        // resolved from the header alone (no tenant path param), so the
        // guard answers 401 rather than the 403 a path-scoped route gives.
        await route.call(otherTenantAdminToken, TENANT_ID).expect(401);
      });

      it(`${route.name} rejects an X-Tenant-ID that matches no school`, async () => {
        await route.call(token, '00000000-0000-4000-8000-000000000fff').expect(401);
      });
    }
  });
});
