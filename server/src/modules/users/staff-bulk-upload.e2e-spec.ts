import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [13.3.2] Staff import: validate (writes nothing) then commit (creates / restores / skips).
 * Every test uses its own mobile/email prefix so the shared worker database stays unambiguous.
 */

const OTHER_USER_ID = '00000000-0000-4000-8000-000000001332';
const OTHER_USER_EMAIL = 'other-admin-1332@testschool.com';
const HEADERS = ['Name', 'Mobile', 'Email', 'Role', 'Designation'];

async function sheet(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Staff');
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Staff bulk import E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let otherToken: string;

  const post = (path: string, as = token, role = UserRole.ADMIN) =>
    supertest(app.getHttpServer())
      .post(`/api/v1/users/bulk-upload/${path}`)
      .set('Authorization', `Bearer ${as}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);
  const validate = (buf: Buffer, as = token, role = UserRole.ADMIN) =>
    post('validate', as, role).attach('file', buf, 'staff.xlsx');
  const commit = (staging_id: string, send_invitations = false, as = token) =>
    post('commit', as).send({ staging_id, send_invitations });
  const userCount = async () =>
    Number((await ds.query('SELECT COUNT(*)::int AS n FROM users'))[0].n);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    // The seed admin also holds TEACHER here so the 403 path can be driven with X-Role.
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'TEACHER', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, SEED_TENANT_ID],
    );
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Other Admin 1332', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_USER_ID, OTHER_USER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [OTHER_USER_ID, SEED_TENANT_ID],
    );
    const login = (email: string) =>
      supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
    token = (await login(SEED_ADMIN_EMAIL)).body.access_token;
    otherToken = (await login(OTHER_USER_EMAIL)).body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('validate reports every bad row and writes nothing; commit refuses that stage', async () => {
    const before = await userCount();
    const res = await validate(
      await sheet([
        ['Good One', '01711000101', '', 'Accountant', ''],
        ['No Contact', '', '', 'Teacher', ''],
        ['Bad Mobile', 'abc', '', 'Teacher', ''],
        ['Bad Email', '', 'not-an-email', 'Teacher', ''],
        ['Bad Role', '01711000102', '', 'Gardener', ''],
        ['Super', '01711000103', '', 'SUPER_ADMIN', ''],
        ['Dup A', '01711000104', '', 'Teacher', ''],
        ['Dup B', '01711000104', '', 'Teacher', ''],
      ]),
    ).expect(201);

    const badRows = res.body.errors.map((e: { row: number }) => e.row).sort();
    expect(badRows).toEqual([3, 4, 5, 6, 7, 9]);
    expect(res.body.hard_error_count).toBe(6);
    expect(await userCount()).toBe(before); // nothing written

    await commit(res.body.staging_id).expect(409);
    expect(await userCount()).toBe(before);
  });

  it('commit creates a teacher (with profile) and a staff member without a password or invitation', async () => {
    const v = await validate(
      await sheet([
        ['Rina Teacher', '০১৭১১০০০২০১', 'rina1332@x.com', 'শিক্ষক', 'Head teacher'],
        ['Karim Accounts', '', 'karim1332@x.com', 'Accountant', 'Whatever'],
      ]),
    ).expect(201);
    expect(v.body.summary).toEqual({ create: 2, restore: 0, skip: 0 });

    const tokensBefore = Number(
      (await ds.query('SELECT COUNT(*)::int AS n FROM auth_tokens'))[0].n,
    );
    const res = await commit(v.body.staging_id, false).expect(201);
    expect(res.body).toMatchObject({ created: 2, restored: 0, skipped: 0, invited: 0, failed: [] });

    const rows = await ds.query(
      `SELECT u.password_hash, ut.tenant_id, ut.role,
              (SELECT designations FROM teachers t WHERE t.user_id = u.id) AS designations
         FROM users u JOIN user_tenants ut ON ut.user_id = u.id
        WHERE u.email IN ('rina1332@x.com','karim1332@x.com') ORDER BY u.email`,
    );
    expect(rows.map((r: { role: string }) => r.role)).toEqual(['ACCOUNTANT', 'TEACHER']);
    for (const r of rows) {
      expect(r.password_hash).toBeNull();
      expect(r.tenant_id).toBe(SEED_TENANT_ID);
    }
    expect(rows[1].designations).toBe('{HEAD_TEACHER}'); // postgres enum[] text form
    const phone = await ds.query(`SELECT phone FROM users WHERE email = 'rina1332@x.com'`);
    expect(phone[0].phone).toBe('01711000201'); // Bangla digits normalised
    // send_invitations=false sends nothing
    const tokensAfter = Number((await ds.query('SELECT COUNT(*)::int AS n FROM auth_tokens'))[0].n);
    expect(tokensAfter).toBe(tokensBefore);
  });

  it('send_invitations=true issues one invitation per created member', async () => {
    const v = await validate(
      await sheet([['Invited Person', '', 'invited1332@x.com', 'Executive', '']]),
    ).expect(201);
    const res = await commit(v.body.staging_id, true).expect(201);
    expect(res.body).toMatchObject({ created: 1, invited: 1, failed: [] });
    const n = await ds.query(
      `SELECT COUNT(*)::int AS n FROM auth_tokens a JOIN users u ON u.id = a.user_id
        WHERE u.email = 'invited1332@x.com'`,
    );
    expect(n[0].n).toBe(1);
  });

  it('skips a current member and restores a former member (same user id, no duplicate)', async () => {
    const first = await validate(
      await sheet([['Former Member', '', 'former1332@x.com', 'Office staff', '']]),
    ).expect(201);
    await commit(first.body.staging_id).expect(201);
    const [{ id }] = await ds.query(`SELECT id FROM users WHERE email = 'former1332@x.com'`);
    await ds.query(`UPDATE user_tenants SET deleted_at = NOW() WHERE user_id = $1`, [id]);

    const v = await validate(
      await sheet([
        ['Former Member', '', 'former1332@x.com', 'Office staff', ''],
        ['Seed Admin', '', SEED_ADMIN_EMAIL, 'Admin', ''],
      ]),
    ).expect(201);
    expect(v.body.summary).toEqual({ create: 0, restore: 1, skip: 1 });
    const before = await userCount();

    const res = await commit(v.body.staging_id).expect(201);
    expect(res.body).toMatchObject({ created: 0, restored: 1, skipped: 1, failed: [] });
    expect(await userCount()).toBe(before);
    const m = await ds.query(
      `SELECT deleted_at FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`,
      [id, SEED_TENANT_ID],
    );
    expect(m).toHaveLength(1);
    expect(m[0].deleted_at).toBeNull();
  });

  it('an email used by an account in another school is a row error, not a created duplicate', async () => {
    // A user that exists but holds no membership here stands in for "another school".
    await ds.query(
      `INSERT INTO users (id, email, full_name, status, created_at, updated_at)
       VALUES (gen_random_uuid(), 'elsewhere1332@x.com', 'Elsewhere', 'ACTIVE', NOW(), NOW())`,
    );
    const res = await validate(
      await sheet([['Someone', '', 'elsewhere1332@x.com', 'Teacher', '']]),
    ).expect(201);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].message).toMatch(/already used by another account/);
  });

  it('a stage cannot be committed twice or by another user', async () => {
    const v = await validate(
      await sheet([['Once Only', '', 'once1332@x.com', 'Teacher', '']]),
    ).expect(201);
    await commit(v.body.staging_id, false, otherToken).expect(404);
    await commit(v.body.staging_id).expect(201);
    await commit(v.body.staging_id).expect(404);
  });

  it('refuses a TEACHER on both routes', async () => {
    const buf = await sheet([['X', '', 'x1332@x.com', 'Teacher', '']]);
    await validate(buf, token, UserRole.TEACHER).expect(403);
    await post('commit', token, UserRole.TEACHER)
      .send({ staging_id: '00000000-0000-4000-8000-000000000000', send_invitations: false })
      .expect(403);
  });
});
