import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { AttentionScheduler } from '../engine/attention-scheduler';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * [67.1.10] Attention isolation: no user ever sees another school's or another
 * user's alert rows. Two schools (A, B); X is a TEACHER in both.
 */
const id = (n: number) => `00000000-0000-4000-8000-0000001e10${String(n).padStart(2, '0')}`;
const SCHOOL_A = id(1);
const SCHOOL_B = id(2);
const USERS = {
  A_ADMIN: { id: id(3), email: 'a-admin@attn-iso.example' },
  A_TEACHER: { id: id(4), email: 'a-teacher@attn-iso.example' },
  B_ADMIN: { id: id(5), email: 'b-admin@attn-iso.example' },
  X: { id: id(6), email: 'x@attn-iso.example' },
};
const STUDENT_A = id(7);
const STUDENT_B = id(8);
const ALERT_A1 = id(9);
const ALERT_B1 = id(10);

describe('Attention isolation E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  const classOf: Record<string, string> = {};
  const sectionOf: Record<string, string> = {};
  const recipient: Record<string, string> = {}; // "<alert>:<user>" -> recipient id

  const call = (method: 'get' | 'post', path: string, who: keyof typeof USERS, tenantId: string) =>
    supertest(app.getHttpServer())
      [method](`/api/v1/attention${path}`)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('X-Tenant-ID', tenantId);

  const stateOf = async (recipientId: string) =>
    (
      await ds.query(`SELECT state, seen_at FROM alert_recipients WHERE id = $1`, [recipientId])
    )[0] as { state: string; seen_at: Date | null };

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    // The app's own BullMQ sweeps run every rule at the real clock (CI: Saturday 09:08 Dhaka) and
    // can resolve or add alerts between a fixture and a read. Only this file's fixtures may write.
    await app.get(AttentionScheduler).worker.close();
    ds = app.get(DataSource);

    for (const [sid, slug] of [
      [SCHOOL_A, 'attn-iso-a'],
      [SCHOOL_B, 'attn-iso-b'],
    ]) {
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, $2, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [sid, slug],
      );
    }
    const members: [keyof typeof USERS, string, UserRole][] = [
      ['A_ADMIN', SCHOOL_A, UserRole.ADMIN],
      ['A_TEACHER', SCHOOL_A, UserRole.TEACHER],
      ['B_ADMIN', SCHOOL_B, UserRole.ADMIN],
      ['X', SCHOOL_A, UserRole.TEACHER],
      ['X', SCHOOL_B, UserRole.TEACHER],
    ];
    for (const u of Object.values(USERS)) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Attn Iso', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, u.email, SEED_ADMIN_PASSWORD_HASH],
      );
    }
    for (const [who, school, role] of members) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [USERS[who].id, school, role],
      );
    }
    // Years, classes and sections are not truncated between tests; students, alerts and recipients are (rebuilt in beforeEach).
    for (const school of [SCHOOL_A, SCHOOL_B]) {
      const [year] = await ds.query(
        `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current, created_at, updated_at)
         VALUES ($1, 'AttnIso', '2027-01-01', '2027-12-31', true, NOW(), NOW()) RETURNING id`,
        [school],
      );
      const [klass] = await ds.query(
        `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, 'Attn Iso', $2) RETURNING id`,
        [school, year.id],
      );
      classOf[school] = klass.id;
      [{ id: sectionOf[school] }] = await ds.query(
        `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'A') RETURNING id`,
        [school, klass.id],
      );
    }
    for (const [who, u] of Object.entries(USERS)) {
      tokens[who] = (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: u.email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token;
    }
  }, 60_000);

  // Alerts, recipients, students and sections are truncated before every test: rebuild them.
  beforeEach(async () => {
    for (const [sid, school, reg] of [
      [STUDENT_A, SCHOOL_A, 'ATTN-ISO-A'],
      [STUDENT_B, SCHOOL_B, 'ATTN-ISO-B'],
    ]) {
      await ds.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id)
         VALUES ($1, 'Attn Iso Student', $2, 9982, $3, $4)`,
        [sid, reg, sectionOf[school], school],
      );
    }
    // A1: tenant A WARNING for A_ADMIN + A_TEACHER + X.
    // B1: tenant B CRITICAL about B's student for B_ADMIN + X.
    const alerts: [string, string, string, string | null][] = [
      [ALERT_A1, SCHOOL_A, 'WARNING', null],
      [ALERT_B1, SCHOOL_B, 'CRITICAL', STUDENT_B],
    ];
    for (const [aid, school, severity, subject] of alerts) {
      await ds.query(
        `INSERT INTO alerts (id, tenant_id, rule_key, source, severity, category, dedupe_key, subject_type, subject_id)
         VALUES ($1, $2, 'x.unknown', 'RULE', $3, 'ATTENDANCE', $6, $4, $5)`,
        [aid, school, severity, subject ? 'student' : null, subject, `iso:${aid}`],
      );
    }
    const recipients: [string, string, keyof typeof USERS, UserRole][] = [
      [ALERT_A1, SCHOOL_A, 'A_ADMIN', UserRole.ADMIN],
      [ALERT_A1, SCHOOL_A, 'A_TEACHER', UserRole.TEACHER],
      [ALERT_A1, SCHOOL_A, 'X', UserRole.TEACHER],
      [ALERT_B1, SCHOOL_B, 'B_ADMIN', UserRole.ADMIN],
      [ALERT_B1, SCHOOL_B, 'X', UserRole.TEACHER],
    ];
    for (const [aid, school, who, role] of recipients) {
      const [row] = await ds.query(
        `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [school, aid, USERS[who].id, role],
      );
      recipient[`${aid}:${who}`] = row.id;
    }
  });

  afterAll(async () => {
    // alerts cascade to alert_recipients; schools cascade to memberships.
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    await ds.query(`DELETE FROM students WHERE tenant_id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    await ds.query(`DELETE FROM class_sections WHERE tenant_id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    await ds.query(`DELETE FROM classes WHERE tenant_id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    await ds.query(`DELETE FROM academic_years WHERE tenant_id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [
      Object.values(USERS).map((u) => u.id),
    ]);
    await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [Object.values(USERS).map((u) => u.id)]);
    await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    await app.close();
  });

  it("recipient isolation: A_TEACHER's list holds only its own recipient row", async () => {
    const { body } = await call('get', '/items', 'A_TEACHER', SCHOOL_A).expect(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].recipientId).toBe(recipient[`${ALERT_A1}:A_TEACHER`]);
    expect(JSON.stringify(body)).not.toContain(recipient[`${ALERT_A1}:A_ADMIN`]);
  });

  it("A_TEACHER cannot hide A_ADMIN's recipient: 404 and the row stays OPEN", async () => {
    const theirs = recipient[`${ALERT_A1}:A_ADMIN`];
    await call('post', `/items/${theirs}/hide`, 'A_TEACHER', SCHOOL_A).expect(404);
    expect((await stateOf(theirs)).state).toBe('OPEN');
  });

  it("A_TEACHER cannot mark A_ADMIN's recipient seen: updated 0, seen_at untouched", async () => {
    const theirs = recipient[`${ALERT_A1}:A_ADMIN`];
    const { body } = await call('post', '/items/seen', 'A_TEACHER', SCHOOL_A)
      .send({ recipientIds: [theirs] })
      .expect(200);
    expect(body).toEqual({ updated: 0 });
    expect((await stateOf(theirs)).seen_at).toBeNull();
  });

  it('tenant isolation, same user: X sees A then B counts (summary cache is per tenant)', async () => {
    const a = await call('get', '/summary', 'X', SCHOOL_A).expect(200);
    expect(a.body).toMatchObject({ critical: 0, warning: 1 });
    const b = await call('get', '/summary', 'X', SCHOOL_B).expect(200);
    expect(b.body).toMatchObject({ critical: 1, warning: 0 });
  });

  it('X cannot reach its own tenant-B recipient through tenant A: 404, B row stays OPEN', async () => {
    const b1 = recipient[`${ALERT_B1}:X`];
    await call('post', `/items/${b1}/hide`, 'X', SCHOOL_A).expect(404);
    expect((await stateOf(b1)).state).toBe('OPEN');
  });

  it('A_ADMIN naming school B (not a member) is rejected with 401, as in the tenant guard', async () => {
    await call('get', '/summary', 'A_ADMIN', SCHOOL_B).expect(401);
  });

  it("A_ADMIN (tenant A) gets 404 for B's student, never B1's data", async () => {
    await call('get', `/students/${STUDENT_B}`, 'A_ADMIN', SCHOOL_A).expect(404);
  });

  it("B_ADMIN history returns exactly B's resolved row and none of tenant A's", async () => {
    // One RESOLVED recipient per school (history only lists closed rows); A's belongs to A_ADMIN.
    const resolved: Record<string, string> = {};
    for (const [key, school, who, role] of [
      ['A', SCHOOL_A, 'A_ADMIN', UserRole.ADMIN],
      ['B', SCHOOL_B, 'B_ADMIN', UserRole.ADMIN],
    ] as const) {
      const [alert] = await ds.query(
        `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, dedupe_key, status, resolved_at)
         VALUES ($1, 'x.unknown', 'RULE', 'WARNING', 'ATTENDANCE', $2, 'RESOLVED', NOW()) RETURNING id`,
        [school, `iso-resolved:${key}`],
      );
      const [row] = await ds.query(
        `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role, state, resolved_at)
         VALUES ($1, $2, $3, $4, 'RESOLVED', NOW()) RETURNING id`,
        [school, alert.id, USERS[who].id, role],
      );
      resolved[key] = row.id;
    }
    const { body } = await call('get', '/items?tab=history', 'B_ADMIN', SCHOOL_B).expect(200);
    expect(body.items.map((i: { recipientId: string }) => i.recipientId)).toEqual([resolved.B]);
    expect(JSON.stringify(body)).not.toContain(resolved.A);
  });
});
