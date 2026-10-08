import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { todayInSchoolTz } from '../../../common/time';

/**
 * [48.2.05] `issue_values` over HTTP. The role matrix is 48.2.04's; here only a deny
 * and a cross-tenant check prove the new body field changes neither.
 */
const API = '/api/v1';
const CONDUCT = 'তার আচরণ সন্তোষজনক';

describe('Certificates issue_values E2E (48.2.05)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  let student: string;
  let boundTpl: string;
  let tenant2Tpl: string;

  const http = () => supertest(app.getHttpServer());
  const as = (role: string, tenant = SEED_TENANT_ID) => ({
    Authorization: `Bearer ${tokens[role]}`,
    'X-Tenant-ID': tenant,
  });
  const body = (tpl: string, extra: object = {}) => ({
    template_id: tpl,
    subject_type: 'STUDENT',
    subject_ids: [student],
    ...extra,
  });

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(tenantId: string, role: string): Promise<string> {
    const id = randomUUID();
    const email = `issue-e2e-${role}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Issue E2E', 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return email;
  }

  // A published CHARACTER_CERTIFICATE that places issue.conduct (as a field).
  async function boundTemplate(tenantId: string): Promise<string> {
    const [t] = await ds.query(
      `INSERT INTO print_templates (tenant_id, document_kind, name, batch_size, draft)
       VALUES ($1, 'CHARACTER_CERTIFICATE', $2, 50, '{}'::jsonb) RETURNING id`,
      [tenantId, `Char ${randomUUID()}`],
    );
    const definition = {
      front: { elements: [{ type: 'TEXT', x: 0, y: 0, w: 10, h: 5, field: 'issue.conduct' }] },
    };
    const [v] = await ds.query(
      `INSERT INTO print_template_versions (tenant_id, template_id, version, definition)
       VALUES ($1, $2, 1, $3::jsonb) RETURNING id`,
      [tenantId, t.id, JSON.stringify(definition)],
    );
    await ds.query(`UPDATE print_templates SET current_version_id = $1 WHERE id = $2`, [
      v.id,
      t.id,
    ]);
    return t.id;
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
  });

  afterAll(async () => {
    await app.close();
  });

  // The suite's setup wipes tenant data before every test, so seed per test.
  beforeEach(async () => {
    tokens.ADMIN = await login(SEED_ADMIN_EMAIL);
    tokens.OFFICE_STAFF = await login(await addUser(SEED_TENANT_ID, 'OFFICE_STAFF'));
    tokens.ACCOUNTANT = await login(await addUser(SEED_TENANT_ID, 'ACCOUNTANT'));

    const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;
    // The Dhaka calendar year, so the fixture is current whatever day this runs.
    const y = Number(todayInSchoolTz().slice(0, 4));
    const year = await one(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id, created_at, updated_at)
       VALUES ($2, $3, $4, $1, NOW(), NOW()) RETURNING id`,
      [SEED_TENANT_ID, `Issue E2E ${randomUUID()}`, `${y}-01-01`, `${y}-12-31`],
    );
    const cls = await one(
      `INSERT INTO classes (name, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($3, $1, $2, NOW(), NOW()) RETURNING id`,
      [year, SEED_TENANT_ID, `Issue E2E ${randomUUID()}`],
    );
    const section = await one(
      `INSERT INTO class_sections (class_id, section_name, tenant_id, created_at, updated_at)
       VALUES ($1, 'A', $2, NOW(), NOW()) RETURNING id`,
      [cls, SEED_TENANT_ID],
    );
    student = await one(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, created_at, updated_at)
       VALUES ('Issue E2E Rahim', $1, 1, $2, $3, NOW(), NOW()) RETURNING id`,
      [`IE-${randomUUID().slice(0, 8)}`, section, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO enrollments (student_id, class_id, section_id, academic_year_id, tenant_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
      [student, cls, section, year, SEED_TENANT_ID],
    );
    boundTpl = await boundTemplate(SEED_TENANT_ID);

    const tenant2Id = await one(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `Issue E2E T2 ${randomUUID()}`,
      `issue-e2e-${randomUUID()}`,
    ]);
    await addUser(tenant2Id, 'ADMIN');
    tenant2Tpl = await boundTemplate(tenant2Id);
  });

  it('OFFICE_STAFF issues with issue.conduct -> 201 and the item shows the text', async () => {
    const res = await http()
      .post(`${API}/certificates`)
      .set(as('OFFICE_STAFF'))
      .send(body(boundTpl, { issue_values: { 'issue.conduct': CONDUCT } }))
      .expect(201);
    expect(res.body.items[0].values['issue.conduct']).toBe(CONDUCT);
  });

  it('a missing value -> 400 with the field key in message', async () => {
    const res = await http()
      .post(`${API}/certificates`)
      .set(as('OFFICE_STAFF'))
      .send(body(boundTpl))
      .expect(400);
    expect(res.body.message).toEqual(['issue.conduct: required']);
  });

  it('an unplaced key -> 400', async () => {
    const res = await http()
      .post(`${API}/certificates`)
      .set(as('OFFICE_STAFF'))
      .send(body(boundTpl, { issue_values: { 'issue.conduct': 'ok', 'issue.remark': 'x' } }))
      .expect(400);
    expect(res.body.message).toEqual(['issue.remark: not an issue field of this template']);
  });

  it('a non-string value -> 400 (DTO)', async () => {
    await http()
      .post(`${API}/certificates`)
      .set(as('OFFICE_STAFF'))
      .send(body(boundTpl, { issue_values: { 'issue.conduct': 5 } }))
      .expect(400);
  });

  it('preview echoes the typed text; ACCOUNTANT -> 403', async () => {
    const res = await http()
      .post(`${API}/certificates/preview`)
      .set(as('ADMIN'))
      .send(body(boundTpl, { issue_values: { 'issue.conduct': CONDUCT } }))
      .expect(200);
    expect(res.body.items[0].values['issue.conduct']).toBe(CONDUCT);
    await http()
      .post(`${API}/certificates/preview`)
      .set(as('ACCOUNTANT'))
      .send(body(boundTpl, { issue_values: { 'issue.conduct': CONDUCT } }))
      .expect(403);
  });

  it('ACCOUNTANT creating with issue_values -> 403', async () => {
    await http()
      .post(`${API}/certificates`)
      .set(as('ACCOUNTANT'))
      .send(body(boundTpl, { issue_values: { 'issue.conduct': CONDUCT } }))
      .expect(403);
  });

  it("tenant 2's template used by tenant 1 -> 404, not a validation answer", async () => {
    await http()
      .post(`${API}/certificates`)
      .set(as('ADMIN'))
      .send(body(tenant2Tpl, { issue_values: { 'issue.conduct': CONDUCT } }))
      .expect(404);
  });
});
