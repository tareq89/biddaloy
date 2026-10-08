import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { hashSecret } from '../../auth/token-hash.util';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [48.2.06] The certificate register over HTTP: who may read it, that the CSV is safe to open
 * in Excel, that tenants never see each other's serials, and that a blank revoke reason is refused.
 * Serial rows are inserted directly; the issuing flow is a separate ticket.
 */
const API = '/api/v1';
const ALLOWED = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
];
const DENIED = [
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

describe('Certificate register E2E (48.2.06)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  let otherTenantId: string;
  let otherAdminToken: string;
  let revokableItemId: string;
  const VERIFY_TOKEN = `verify-${randomUUID()}`;

  const http = () => supertest(app.getHttpServer());
  const as = (role: string, tenant = SEED_TENANT_ID) => ({
    Authorization: `Bearer ${tokens[role]}`,
    'X-Tenant-ID': tenant,
  });

  async function addUser(role: UserRole, tenantId: string): Promise<string> {
    const id = randomUUID();
    const email = `reg-e2e-${role}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH, `Reg E2E ${role}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return email;
  }
  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  /** A print job (template + version + job) in `tenant`, returning the job id. */
  async function seedJob(tenant: string): Promise<string> {
    const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    const tpl = await one(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, 'TESTIMONIAL', 'Reg E2E', 1, '{}'::jsonb) RETURNING id`,
      [tenant],
    );
    const ver = await one(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, '{}'::jsonb) RETURNING id`,
      [tenant, tpl],
    );
    return one(
      `INSERT INTO print_jobs (tenant_id, template_version_id, document_kind, item_count)
       VALUES ($1, $2, 'TESTIMONIAL', 1) RETURNING id`,
      [tenant, ver],
    );
  }
  async function seedItem(tenant: string, job: string, label: string, no: number, hash?: string) {
    const serial = `TSM-2026-${String(no).padStart(5, '0')}`;
    return (
      await ds.query(
        `INSERT INTO print_job_items
           (tenant_id, job_id, document_kind, subject_type, subject_id, subject_label, copy_number,
            serial_no, serial_year, data_snapshot, verify_token_hash)
         VALUES ($1, $2, 'TESTIMONIAL', 'STUDENT', $3, $4, 1, $5, 2026, $6::jsonb, $7) RETURNING id`,
        [
          tenant,
          job,
          randomUUID(),
          label,
          no,
          JSON.stringify({ values: { 'print.serial_no': serial, 'student.class': 'Class 10' } }),
          hash ?? hashSecret(randomUUID()),
        ],
      )
    )[0].id as string;
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

    tokens[UserRole.ADMIN] = await login(SEED_ADMIN_EMAIL);
    for (const role of [...ALLOWED, ...DENIED]) {
      if (role === UserRole.ADMIN) continue;
      tokens[role] = await login(await addUser(role, SEED_TENANT_ID));
    }
    otherTenantId = (
      await ds.query(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
        `Reg Other ${randomUUID()}`,
        `reg-other-${randomUUID()}`,
      ])
    )[0].id as string;
    otherAdminToken = await login(await addUser(UserRole.ADMIN, otherTenantId));
  });

  // test/setup.ts wipes the print tables before every test, so seed per test.
  beforeEach(async () => {
    const job = await seedJob(SEED_TENANT_ID);
    revokableItemId = await seedItem(SEED_TENANT_ID, job, 'Reg Rahim', 1, hashSecret(VERIFY_TOKEN));
    await seedItem(SEED_TENANT_ID, job, 'রহিম উদ্দিন', 2);
    await seedItem(SEED_TENANT_ID, job, '=HYPERLINK("http://evil")', 3);
    await seedItem(otherTenantId, await seedJob(otherTenantId), 'Other Tenant Kid', 1);
  });

  afterAll(async () => {
    await app.close();
  });

  it('role matrix: register and register.csv', async () => {
    for (const path of ['register', 'register.csv']) {
      for (const role of ALLOWED) {
        await http().get(`${API}/print-history/${path}`).set(as(role)).expect(200);
      }
      for (const role of DENIED) {
        await http().get(`${API}/print-history/${path}`).set(as(role)).expect(403);
      }
    }
  });

  it('CSV: BOM, Bangla round-trips, formula is neutralised', async () => {
    const res = await http()
      .get(`${API}/print-history/register.csv`)
      .set(as(UserRole.ADMIN))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('certificate-register.csv');
    const text = (res.body as Buffer).toString('utf-8');
    expect(text.startsWith('\uFEFF"ক্রমিক নং / Serial","কপি / Copy","দলিল / Document"')).toBe(true);
    expect(text).toContain('রহিম উদ্দিন');
    // A cell that starts with "=" must not reach Excel as a formula.
    expect(text).not.toMatch(/"=HYPERLINK/);
    expect(text).not.toContain('Other Tenant Kid');
  });

  it('is tenant scoped, and needs X-Tenant-ID', async () => {
    const other = await http()
      .get(`${API}/print-history/register`)
      .set({ Authorization: `Bearer ${otherAdminToken}`, 'X-Tenant-ID': otherTenantId })
      .expect(200);
    expect(other.body.data.map((r: any) => r.subject_label)).toEqual(['Other Tenant Kid']);
    await http()
      .get(`${API}/print-history/register`)
      .set({ Authorization: `Bearer ${tokens[UserRole.ADMIN]}` })
      .expect(401);
  });

  it('blank revoke reason is 400 and leaves the item valid; a real reason shows in REVOKED', async () => {
    await http()
      .post(`${API}/print-history/items/${revokableItemId}/revoke`)
      .set(as(UserRole.ADMIN))
      .send({ reason: '   ' })
      .expect(400);
    const still = await http()
      .get(`${API}/print-history/register?status=REVOKED`)
      .set(as(UserRole.ADMIN))
      .expect(200);
    expect(still.body.total).toBe(0);

    const verifyBefore = await http().get(`${API}/public/verify/${VERIFY_TOKEN}`).expect(200);
    expect(verifyBefore.body).toMatchObject({ status: 'VALID', serial: 'TSM-2026-00001' });

    await http()
      .post(`${API}/print-history/items/${revokableItemId}/revoke`)
      .set(as(UserRole.ADMIN))
      .send({ reason: '  Wrong father name  ' })
      .expect(200);
    const revoked = await http()
      .get(`${API}/print-history/register?status=REVOKED`)
      .set(as(UserRole.ADMIN))
      .expect(200);
    expect(revoked.body.data).toHaveLength(1);
    expect(revoked.body.data[0].revoke_reason).toBe('Wrong father name');

    const verifyAfter = await http().get(`${API}/public/verify/${VERIFY_TOKEN}`).expect(200);
    expect(verifyAfter.body).toMatchObject({ status: 'REVOKED', serial: 'TSM-2026-00001' });
  });
});
