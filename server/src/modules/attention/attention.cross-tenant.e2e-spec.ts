import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { AttentionScheduler } from './engine/attention-scheduler';
import { SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * [67.6.02] Tenant isolation for every attention route, proven with a real member of both
 * schools: ONE token, two ADMIN memberships, so ContextGuard passes for both and every
 * rejection below comes from the service layer's own tenant scoping.
 *
 * Routes (contract section 5) and where each is covered:
 *   GET    /attention/summary                       summary
 *   GET    /attention/items?tab=active|history      items
 *   POST   /attention/items/seen                    seen
 *   POST   /attention/items/:recipientId/hide       hide
 *   POST   /attention/items/:recipientId/snooze     snooze
 *   GET    /attention/students/:studentId           student
 *   GET    /attention/manual                        manual list
 *   POST   /attention/manual                        manual send (audience naming A's ids)
 *   POST   /attention/manual/preview                manual preview
 *   DELETE /attention/manual/:id                    manual withdraw
 *   GET    /attention/report                        report
 *   GET    /users/me/preferences/notifications      prefs read
 *   PATCH  /users/me/preferences/notifications      prefs write
 *   GET    /platform/attention/health               platform health (SUPER_ADMIN only)
 * A new /attention route without a case below is a gap: add one.
 *
 * Real behaviour pinned here: a non-member naming a school gets 401 (ContextGuard); another
 * school's id on hide/snooze/student/withdraw is 404.
 */
const id = (n: number) => `00000000-0000-4000-8000-0000002b60${String(n).padStart(2, '0')}`;
const SCHOOL_A = id(1);
const SCHOOL_B = id(2);
const ADMIN = { id: id(3), email: 'admin@attn-xt.example' };
const OUTSIDER = { id: id(4), email: 'outsider@attn-xt.example' }; // ADMIN of B only
const STUDENT_A = id(5);
const ALERT_RULE_A = id(6);
const ALERT_MANUAL_A = id(7);
const ALERT_STUDENT_A = id(8);

describe('Attention cross-tenant E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  let outsiderToken: string;
  let sectionA: string;
  let recipientA: string;
  let manualRecipientA: string;
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' })
    .format(new Date())
    .slice(0, 7);

  const call = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    tenantId: string,
    as = token,
  ) =>
    supertest(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${as}`)
      .set('X-Tenant-ID', tenantId);

  const rowOf = async (recipientId: string) =>
    (
      await ds.query(`SELECT state, seen_at, snoozed_until FROM alert_recipients WHERE id = $1`, [
        recipientId,
      ])
    )[0] as { state: string; seen_at: Date | null; snoozed_until: Date | null };

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
    // The live BullMQ scheduler sweeps on the real clock and would race exact-count assertions.
    await app.get(AttentionScheduler).worker.close();
    ds = app.get(DataSource);

    // Different quiet hours per school, to prove the prefs read is tenant-scoped.
    for (const [sid, slug, start, end] of [
      [SCHOOL_A, 'attn-xt-a', '20:00', '06:00'],
      [SCHOOL_B, 'attn-xt-b', '22:00', '05:00'],
    ]) {
      await ds.query(
        `INSERT INTO schools (id, name, slug, settings, created_at, updated_at)
         VALUES ($1, $2, $2, $3::jsonb, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [sid, slug, JSON.stringify({ attention: { quietHours: { start, end } } })],
      );
    }
    for (const u of [ADMIN, OUTSIDER]) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Attn Xt', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [u.id, u.email, SEED_ADMIN_PASSWORD_HASH],
      );
    }
    for (const [uid, school] of [
      [ADMIN.id, SCHOOL_A],
      [ADMIN.id, SCHOOL_B],
      [OUTSIDER.id, SCHOOL_B],
    ]) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [uid, school, UserRole.ADMIN],
      );
    }
    const [year] = await ds.query(
      `INSERT INTO academic_years (tenant_id, name, start_date, end_date, is_current, created_at, updated_at)
       VALUES ($1, 'AttnXt', '2027-01-01', '2027-12-31', true, NOW(), NOW()) RETURNING id`,
      [SCHOOL_A],
    );
    const [klass] = await ds.query(
      `INSERT INTO classes (tenant_id, name, academic_year_id) VALUES ($1, 'Attn Xt', $2) RETURNING id`,
      [SCHOOL_A, year.id],
    );
    [{ id: sectionA }] = await ds.query(
      `INSERT INTO class_sections (tenant_id, class_id, section_name) VALUES ($1, $2, 'A') RETURNING id`,
      [SCHOOL_A, klass.id],
    );
    const login = async (u: { email: string }) =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email: u.email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    token = await login(ADMIN);
    outsiderToken = await login(OUTSIDER);
  }, 60_000);

  // Students, alerts and recipients are truncated before every test: rebuild them.
  beforeEach(async () => {
    await ds.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id)
       VALUES ($1, 'Attn Xt Student', 'ATTN-XT-A', 9983, $2, $3)`,
      [STUDENT_A, sectionA, SCHOOL_A],
    );

    // Tenant A: a rule alert, a manual alert, an alert about A's student; ADMIN is a recipient of each.
    const alerts: [string, string, string, string | null][] = [
      [ALERT_RULE_A, 'RULE', 'attendance.not_taken', null],
      [ALERT_MANUAL_A, 'MANUAL', 'manual.alert', null],
      [ALERT_STUDENT_A, 'RULE', 'x.unknown', STUDENT_A],
    ];
    for (const [aid, source, ruleKey, subject] of alerts) {
      await ds.query(
        `INSERT INTO alerts (id, tenant_id, rule_key, source, severity, category, dedupe_key, subject_type, subject_id, raised_at)
         VALUES ($1, $2, $3, $4, 'WARNING', 'ATTENDANCE', $5, $6, $7, now())`,
        [aid, SCHOOL_A, ruleKey, source, `xt:${aid}`, subject ? 'student' : null, subject],
      );
      const [row] = await ds.query(
        `INSERT INTO alert_recipients (tenant_id, alert_id, user_id, role) VALUES ($1, $2, $3, 'ADMIN') RETURNING id`,
        [SCHOOL_A, aid, ADMIN.id],
      );
      if (aid === ALERT_RULE_A) recipientA = row.id;
      if (aid === ALERT_MANUAL_A) manualRecipientA = row.id;
    }
  });

  afterAll(async () => {
    // alerts cascade to alert_recipients; schools cascade to memberships.
    await ds.query(`DELETE FROM alerts WHERE tenant_id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    await ds.query(`DELETE FROM students WHERE tenant_id = $1`, [SCHOOL_A]);
    await ds.query(`DELETE FROM class_sections WHERE tenant_id = $1`, [SCHOOL_A]);
    await ds.query(`DELETE FROM classes WHERE tenant_id = $1`, [SCHOOL_A]);
    await ds.query(`DELETE FROM academic_years WHERE tenant_id = $1`, [SCHOOL_A]);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [[ADMIN.id, OUTSIDER.id]]);
    await ds.query(`DELETE FROM users WHERE id = ANY($1)`, [[ADMIN.id, OUTSIDER.id]]);
    await ds.query(`DELETE FROM schools WHERE id = ANY($1)`, [[SCHOOL_A, SCHOOL_B]]);
    await app.close();
  });

  it('sanity: in school A the same admin sees all three alerts', async () => {
    const { body } = await call('get', '/attention/items?tab=active', SCHOOL_A).expect(200);
    expect(body.items).toHaveLength(3);
    expect((await call('get', '/attention/summary', SCHOOL_A).expect(200)).body.warning).toBe(3);
  });

  it('summary and items (both tabs) in B hold none of A', async () => {
    const summary = await call('get', '/attention/summary', SCHOOL_B).expect(200);
    expect(summary.body).toMatchObject({ critical: 0, warning: 0 });
    for (const tab of ['active', 'history']) {
      const { body } = await call('get', `/attention/items?tab=${tab}`, SCHOOL_B).expect(200);
      expect(body.items).toEqual([]);
    }
  });

  it("hide, snooze and seen in B cannot touch A's recipient rows", async () => {
    await call('post', `/attention/items/${recipientA}/hide`, SCHOOL_B).expect(404);
    await call('post', `/attention/items/${recipientA}/snooze`, SCHOOL_B)
      .send({ choice: 'TWO_HOURS' })
      .expect(404);
    const seen = await call('post', '/attention/items/seen', SCHOOL_B)
      .send({ recipientIds: [recipientA] })
      .expect(200);
    expect(seen.body).toEqual({ updated: 0 });
    expect(await rowOf(recipientA)).toEqual({ state: 'OPEN', seen_at: null, snoozed_until: null });
  });

  it("GET /attention/students/:id for A's student in B is 404", async () => {
    await call('get', `/attention/students/${STUDENT_A}`, SCHOOL_B).expect(404);
  });

  it("manual: list in B has none of A's, withdraw is 404 and A's alert stays ACTIVE", async () => {
    const list = await call('get', '/attention/manual?pageSize=100', SCHOOL_B).expect(200);
    expect(list.body).toMatchObject({ items: [], total: 0 });
    await call('delete', `/attention/manual/${ALERT_MANUAL_A}`, SCHOOL_B).expect(404);
    const [alert] = await ds.query(`SELECT status FROM alerts WHERE id = $1`, [ALERT_MANUAL_A]);
    expect(alert.status).toBe('ACTIVE');
    expect((await rowOf(manualRecipientA)).state).toBe('OPEN');
  });

  it("manual preview and send in B cannot reach A's section", async () => {
    const preview = await call('post', '/attention/manual/preview', SCHOOL_B)
      .send({ audience: { sectionIds: [sectionA], guardiansOfSectionIds: [sectionA] } })
      .expect(200);
    expect(preview.body.recipientCount).toBe(0);
    // an audience that matches no one in B is refused (400), and nothing is written in A
    const sent = await call('post', '/attention/manual', SCHOOL_B).send({
      severity: 'WARNING',
      title: 'xt',
      body: 'xt',
      audience: { sectionIds: [sectionA] },
      expiresOn: `${month}-28`,
    });
    expect(sent.status).toBeLessThan(500);
    expect(sent.status).not.toBe(201);
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM alerts WHERE tenant_id = $1 AND source = 'MANUAL'`,
      [SCHOOL_A],
    );
    expect(n).toBe(1); // still only the seeded one
  });

  it("report in B excludes A's alerts, report in A counts them", async () => {
    const b = await call('get', `/attention/report?month=${month}`, SCHOOL_B).expect(200);
    expect(b.body.facts.total).toBe(0);
    expect(b.body.rows).toEqual([]);
    const a = await call('get', `/attention/report?month=${month}`, SCHOOL_A).expect(200);
    expect(a.body.facts.total).toBeGreaterThan(0);
  });

  it('notification prefs return the quiet hours of the school named, and a write stays per user', async () => {
    const a = await call('get', '/users/me/preferences/notifications', SCHOOL_A).expect(200);
    const b = await call('get', '/users/me/preferences/notifications', SCHOOL_B).expect(200);
    expect(a.body.quietHours).toEqual({ start: '20:00', end: '06:00' });
    expect(b.body.quietHours).toEqual({ start: '22:00', end: '05:00' });
    const patched = await call('patch', '/users/me/preferences/notifications', SCHOOL_B)
      .send({ mutedCategories: ['HOMEWORK'] })
      .expect(200);
    expect(patched.body.quietHours).toEqual({ start: '22:00', end: '05:00' });
    // the outsider (member of B only) is a different account: its mute is untouched
    const out = await call('get', '/users/me/preferences/notifications', SCHOOL_B, outsiderToken);
    expect(out.body.mutedCategories).toEqual([]);
    await call('patch', '/users/me/preferences/notifications', SCHOOL_B)
      .send({ mutedCategories: [] })
      .expect(200);
  });

  it('a non-member naming school A is rejected with 401 on every route', async () => {
    const routes: ['get' | 'post' | 'delete', string][] = [
      ['get', '/attention/summary'],
      ['get', '/attention/items?tab=active'],
      ['post', '/attention/items/seen'],
      ['post', `/attention/items/${recipientA}/hide`],
      ['post', `/attention/items/${recipientA}/snooze`],
      ['get', `/attention/students/${STUDENT_A}`],
      ['get', '/attention/manual'],
      ['post', '/attention/manual'],
      ['post', '/attention/manual/preview'],
      ['delete', `/attention/manual/${ALERT_MANUAL_A}`],
      ['get', `/attention/report?month=${month}`],
      ['get', '/users/me/preferences/notifications'],
    ];
    for (const [method, path] of routes) {
      await call(method, path, SCHOOL_A, outsiderToken).expect(401);
    }
    expect((await rowOf(recipientA)).state).toBe('OPEN');
  });

  it('GET /platform/attention/health is 403 for a school ADMIN', async () => {
    await call('get', '/platform/attention/health', SCHOOL_A).expect(403);
  });
});
