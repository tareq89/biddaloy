import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
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

/**
 * [32.2.9] One end-to-end pass through the print module as the real roles,
 * over HTTP. The logic is covered by the per-service specs; this proves the
 * module is wired into the app and the guards say what D18 says.
 *
 *   ADMIN       creates + publishes a template, adds a printer
 *   ACCOUNTANT  prints 2 students, confirms with 0 failures
 *   EXECUTIVE   reads the history (2 rows)         (ACCOUNTANT may not)
 *   ADMIN       revokes one copy                   (ACCOUNTANT may not)
 *   anyone      opens /public/verify/<token>       REVOKED vs VALID
 */
const API = '/api/v1';

describe('Print module E2E (32.2.9)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<'ADMIN' | 'ACCOUNTANT' | 'EXECUTIVE', string> = {
    ADMIN: '',
    ACCOUNTANT: '',
    EXECUTIVE: '',
  };
  let studentA: string;
  let studentB: string;

  const asRole = (role: keyof typeof tokens) => ({
    Authorization: `Bearer ${tokens[role]}`,
    'X-Tenant-ID': SEED_TENANT_ID,
  });
  const http = () => supertest(app.getHttpServer());
  // A bare "expected 201, got 404" hides which lookup failed; show the body.
  const status = (want: number) => (r: supertest.Response) => {
    if (r.status !== want)
      throw new Error(`expected ${want}, got ${r.status}: ${JSON.stringify(r.body)}`);
  };

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addStaffUser(role: UserRole, label: string): Promise<string> {
    const id = randomUUID();
    const email = `print-e2e-${label}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH, `Print E2E ${label}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, SEED_TENANT_ID, role],
    );
    return email;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    tokens.ADMIN = await login(SEED_ADMIN_EMAIL);
    tokens.ACCOUNTANT = await login(await addStaffUser(UserRole.ACCOUNTANT, 'accountant'));
    tokens.EXECUTIVE = await login(await addStaffUser(UserRole.EXECUTIVE, 'executive'));
  });

  /** Two students with an ACTIVE enrollment, so the ID-card resolver can build their card data. */
  async function seedStudents() {
    const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    const year = await one(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES ('Print E2E Year', '2027-01-01', '2027-12-31', $1, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID],
    );
    const cls = await one(
      `INSERT INTO classes (name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ('Print E2E Class', $1, $2, NOW(), NOW()) RETURNING id`,
      [year, SEED_TENANT_ID],
    );
    const section = await one(
      `INSERT INTO class_sections (class_id, section_name, tenant_id, created_at, updated_at)
       VALUES ($1, 'A', $2, NOW(), NOW()) RETURNING id`,
      [cls, SEED_TENANT_ID],
    );
    const student = async (name: string, roll: number) => {
      const id = await one(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [name, `PE-${randomUUID().slice(0, 8)}`, roll, section, SEED_TENANT_ID],
      );
      await ds.query(
        `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [id, cls, section, year, SEED_TENANT_ID],
      );
      return id;
    };
    studentA = await student('Print E2E Rahim', 1);
    studentB = await student('Print E2E Karim', 2);
  }

  afterAll(async () => {
    await app.close();
  });

  it('runs the whole print flow as the seeded roles', async () => {
    await seedStudents();
    // ADMIN: template from a suggestion, published; and an OFFICE printer.
    const tpl = await http()
      .post(`${API}/print-templates`)
      .set(asRole('ADMIN'))
      .send({ name: 'E2E Classic', suggestion_key: 'student-portrait-classic' })
      .expect(201);
    await http()
      .post(`${API}/print-templates/${tpl.body.id}/publish`)
      .set(asRole('ADMIN'))
      .expect((r) => {
        if (r.status >= 300)
          throw new Error(`publish failed: ${r.status} ${JSON.stringify(r.body)}`);
      });
    const printer = await http()
      .post(`${API}/printers`)
      .set(asRole('ADMIN'))
      .send({ name: 'E2E Office A4', printer_type: 'OFFICE' })
      .expect(201);

    // ACCOUNTANT: prints two students, then confirms with no failures.
    const job = await http()
      .post(`${API}/print-jobs`)
      .set(asRole('ACCOUNTANT'))
      .send({
        template_id: tpl.body.id,
        subject_type: 'STUDENT',
        subject_ids: [studentA, studentB],
        printer_profile_id: printer.body.id,
      })
      .expect(status(201));
    expect(job.body.items).toHaveLength(2);
    await http()
      .patch(`${API}/print-jobs/${job.body.job_id}/confirm`)
      .set(asRole('ACCOUNTANT'))
      .send({ failed_item_ids: [] })
      .expect(200);

    // EXECUTIVE reads the history; ACCOUNTANT is denied it.
    const history = await http().get(`${API}/print-history`).set(asRole('EXECUTIVE')).expect(200);
    expect(history.body.total).toBe(2);
    // PermissionsGuard answers a role without PRINT_HISTORY_READ with 403.
    await http().get(`${API}/print-history`).set(asRole('ACCOUNTANT')).expect(403);

    // Only ADMIN revokes.
    const [first, second] = job.body.items as Array<{ item_id: string; verify_url: string }>;
    await http()
      .post(`${API}/print-history/items/${first.item_id}/revoke`)
      .set(asRole('ACCOUNTANT'))
      .send({ reason: 'Lost' })
      .expect(403);
    await http()
      .post(`${API}/print-history/items/${first.item_id}/revoke`)
      .set(asRole('ADMIN'))
      .send({ reason: 'Lost' })
      .expect(200);

    // Public verify: no auth headers at all.
    const revoked = await http()
      .get(`${API}/public/verify/${first.verify_url.replace('/v/', '')}`)
      .expect(200);
    const valid = await http()
      .get(`${API}/public/verify/${second.verify_url.replace('/v/', '')}`)
      .expect(200);
    expect(revoked.body.status).toBe('REVOKED');
    expect(valid.body.status).toBe('VALID');
    expect(Object.keys(valid.body)).not.toContain('subject_id');
    await http().get(`${API}/public/verify/not-a-token`).expect(404);
  });
});
