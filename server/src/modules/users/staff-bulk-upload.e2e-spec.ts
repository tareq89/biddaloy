import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { TeacherService } from './users.service';
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
    // Test env has no SMS/email provider, so delivery may report FAILED: that must land in
    // invite_failed and never in invited. Either way each member is accounted for exactly once.
    expect(res.body).toMatchObject({ created: 1, failed: [] });
    expect(res.body.invited + res.body.invite_failed.length).toBe(1);
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

  describe('identifiers that belong to accounts outside this school', () => {
    const OTHER_SCHOOL = '00000000-0000-4000-8000-000000001333';
    const OTHER_SCHOOL_NAME = 'Hidden Other School 1332';

    /** A user whose memberships are all in `OTHER_SCHOOL` (or nowhere). */
    async function otherSchoolUser(
      email: string | null,
      phone: string | null,
      opts: { member?: 'active' | 'former'; deletedAccount?: boolean } = {},
    ) {
      const [{ id }] = await ds.query(
        `INSERT INTO users (id, email, phone, full_name, status, deleted_at, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, 'Elsewhere', 'ACTIVE', $3, NOW(), NOW()) RETURNING id`,
        [email, phone, opts.deletedAccount ? new Date() : null],
      );
      if (opts.member) {
        await ds.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, deleted_at, created_at, updated_at)
           VALUES ($1, $2, 'TEACHER', $3, NOW(), NOW())`,
          [id, OTHER_SCHOOL, opts.member === 'former' ? new Date() : null],
        );
      }
      return id as string;
    }

    it('are row errors, never a skip, restore or duplicate (tenant filter on the membership lookup)', async () => {
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, $2, 'hidden-other-1332', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`,
        [OTHER_SCHOOL, OTHER_SCHOOL_NAME],
      );
      await otherSchoolUser('o-active1332@x.com', null, { member: 'active' }); // by email
      await otherSchoolUser(null, '01811000002', { member: 'former' }); // by phone
      await otherSchoolUser('o-nomember1332@x.com', null); // no membership anywhere
      await otherSchoolUser('o-deleted1332@x.com', null, { deletedAccount: true });
      await otherSchoolUser('o-two1332@x.com', null);
      await otherSchoolUser(null, '01811000005', {});

      const res = await validate(
        await sheet([
          ['A', '', 'o-active1332@x.com', 'Teacher', ''],
          ['B', '01811000002', '', 'Teacher', ''],
          ['C', '', 'o-nomember1332@x.com', 'Teacher', ''],
          ['D', '', 'o-deleted1332@x.com', 'Teacher', ''],
          ['E', '01811000005', 'o-two1332@x.com', 'Teacher', ''],
        ]),
      ).expect(201);

      // Removing `tenant_id` from the membership lookup turns rows 2 and 3 into skip/restore.
      expect(res.body.summary).toEqual({ create: 0, restore: 0, skip: 0 });
      expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([2, 3, 4, 5, 6]);
      const text = JSON.stringify(res.body.errors);
      expect(text).toMatch(/already used by another account/);
      expect(text).toMatch(/two different accounts/);
      expect(text).not.toContain(OTHER_SCHOOL_NAME);
      expect(text).not.toContain(OTHER_SCHOOL);
    });
  });

  describe('restore is per role', () => {
    async function member(email: string, rows: [string, boolean][]) {
      const [{ id }] = await ds.query(
        `INSERT INTO users (id, email, full_name, status, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'Multi', 'ACTIVE', NOW(), NOW()) RETURNING id`,
        [email],
      );
      for (const [role, former] of rows) {
        await ds.query(
          `INSERT INTO user_tenants (user_id, tenant_id, role, deleted_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [id, SEED_TENANT_ID, role, former ? new Date() : null],
        );
      }
      return id as string;
    }

    it('active PARENT + former TEACHER, file says Teacher: restores TEACHER only', async () => {
      const id = await member('multi1332@x.com', [
        ['PARENT', false],
        ['TEACHER', true],
      ]);
      const v = await validate(
        await sheet([['Multi', '', 'multi1332@x.com', 'Teacher', '']]),
      ).expect(201);
      expect(v.body.summary).toEqual({ create: 0, restore: 1, skip: 0 });
      const res = await commit(v.body.staging_id).expect(201);
      expect(res.body).toMatchObject({ restored: 1, failed: [] });
      const rows = await ds.query(
        `SELECT role, deleted_at FROM user_tenants WHERE user_id = $1 ORDER BY role`,
        [id],
      );
      expect(rows.map((r: { role: string }) => r.role).sort()).toEqual(['PARENT', 'TEACHER']);
      expect(rows.every((r: { deleted_at: unknown }) => r.deleted_at === null)).toBe(true);
    });

    it('former ADMIN, file says Teacher: row error, ADMIN is not brought back', async () => {
      const id = await member('formeradmin1332@x.com', [['ADMIN', true]]);
      const v = await validate(
        await sheet([['Ex Admin', '', 'formeradmin1332@x.com', 'Teacher', '']]),
      ).expect(201);
      expect(v.body.hard_error_count).toBe(1);
      expect(v.body.errors[0].message).toMatch(/already in this school as ADMIN/);
      const [{ n }] = await ds.query(
        `SELECT COUNT(*)::int AS n FROM user_tenants WHERE user_id = $1 AND deleted_at IS NULL`,
        [id],
      );
      expect(n).toBe(0);
    });

    it('active PARENT only, file says Teacher: row error (no silent skip)', async () => {
      await member('parentonly1332@x.com', [['PARENT', false]]);
      const v = await validate(
        await sheet([['P', '', 'parentonly1332@x.com', 'Teacher', '']]),
      ).expect(201);
      expect(v.body.summary.skip).toBe(0);
      expect(v.body.hard_error_count).toBe(1);
    });
  });

  it('runs the real DTO rules per row: sanitised name, max lengths, numeric mobile', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Staff');
    ws.addRow(HEADERS);
    ws.addRow(['<img src=x onerror=alert(1)>Clean Name', '', 'dto1332@x.com', 'Accountant', '']);
    ws.addRow(['x'.repeat(101), '', 'long1332@x.com', 'Accountant', '']);
    ws.addRow(['Long Phone', '+' + '1'.repeat(21), '', 'Accountant', '']);
    ws.addRow(['Numeric', 1711000199, '', 'Accountant', '']); // Excel number cell: leading 0 is gone
    const v = await validate(Buffer.from(await wb.xlsx.writeBuffer())).expect(201);
    expect(v.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
    expect(v.body.errors[2].message).toMatch(/typed as a number/);
    // The staged name is the sanitised one, not the raw cell.
    expect(v.body.rows[0].name).not.toContain('<');
  });

  it('a failed teacher step rolls the whole row back (no half-made member)', async () => {
    const teachers = app.get(TeacherService);
    const spy = vi.spyOn(teachers, 'create').mockRejectedValueOnce(new Error('boom: db detail'));
    const v = await validate(
      await sheet([['Half Made', '', 'halfmade1332@x.com', 'Teacher', '']]),
    ).expect(201);
    const res = await commit(v.body.staging_id).expect(201);
    spy.mockRestore();
    expect(res.body.created).toBe(0);
    expect(res.body.failed).toEqual([{ row: 2, reason: 'Could not save this row' }]); // no DB text leaked
    const n = await ds.query(`SELECT 1 FROM users WHERE email = 'halfmade1332@x.com'`);
    expect(n).toHaveLength(0);
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
