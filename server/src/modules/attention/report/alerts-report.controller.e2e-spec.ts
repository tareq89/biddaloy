import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { AttentionScheduler } from '../engine/attention-scheduler';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/** E2E for GET /attention/report [67.5.04]. One seed login acts as each role via X-Role. */
describe('Alerts report API E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  let token: string;
  const extra: string[] = [];
  const thisMonth = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);
  const call = (
    qs: string,
    role: UserRole = UserRole.ADMIN,
    tenantId: string | null = SEED_TENANT_ID,
  ) => {
    let req = supertest(app.getHttpServer())
      .get(`/api/v1/attention/report${qs}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Role', role);
    if (tenantId) req = req.set('X-Tenant-ID', tenantId);
    return req;
  };

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
    for (const role of [
      UserRole.EXECUTIVE,
      UserRole.TEACHER,
      UserRole.ACCOUNTANT,
      UserRole.PARENT,
    ]) {
      const rows = await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING RETURNING id`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (rows[0]) extra.push(rows[0].id);
    }
    token = (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token;
  }, 60_000);

  beforeEach(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    await ds.query(
      `INSERT INTO alerts (tenant_id, rule_key, source, severity, category, dedupe_key, params, raised_at)
       VALUES ($1, 'attendance.not_taken', 'RULE', 'WARNING', 'ATTENDANCE', gen_random_uuid()::text,
               '{"sectionId":"00000000-0000-4000-8000-0000007b0001","sectionLabel":"7-B"}', now())`,
      [SEED_TENANT_ID],
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM alerts WHERE tenant_id = $1`, [SEED_TENANT_ID]);
    if (extra.length)
      await ds.query(`DELETE FROM user_tenants WHERE id = ANY($1::uuid[])`, [extra]);
    await app.close();
  });

  it('ADMIN and EXECUTIVE get the JSON report', async () => {
    for (const role of [UserRole.ADMIN, UserRole.EXECUTIVE]) {
      const res = await call(`?month=${thisMonth}`, role).expect(200);
      expect(res.body.month).toBe(thisMonth);
      expect(res.body.facts.total).toBe(1);
      expect(res.body.sections).toEqual([
        { id: '00000000-0000-4000-8000-0000007b0001', label: '7-B' },
      ]);
    }
  });

  it('TEACHER, ACCOUNTANT and PARENT get 403', async () => {
    for (const role of [UserRole.TEACHER, UserRole.ACCOUNTANT, UserRole.PARENT])
      await call(`?month=${thisMonth}`, role).expect(403);
  });

  it('missing or foreign X-Tenant-ID is rejected', async () => {
    await call(`?month=${thisMonth}`, UserRole.ADMIN, null).expect(401);
    await call(
      `?month=${thisMonth}`,
      UserRole.ADMIN,
      '00000000-0000-4000-8000-00000000dead',
    ).expect(401);
    await supertest(app.getHttpServer()).get('/api/v1/attention/report').expect(401);
  });

  it('rejects a bad month, an unknown rule, a bad section, a bad format and an old month', async () => {
    await call('?month=2026-13').expect(400);
    await call('').expect(400);
    await call(`?month=${thisMonth}&ruleKey=nope.nope`).expect(400);
    await call(`?month=${thisMonth}&ruleKey=manual.alert`).expect(400);
    await call(`?month=${thisMonth}&sectionId=not-a-uuid`).expect(400);
    await call(`?month=${thisMonth}&format=xml`).expect(400);
    await call('?month=2020-01').expect(400); // older than the 12-month retention
  });

  it('format=csv downloads a BOM-prefixed CSV with the header line', async () => {
    const res = await call(`?month=${thisMonth}&format=csv`)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c) => (data += c));
        r.on('end', () => cb(null, data));
      })
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="alerts-report-${thisMonth}.csv"`,
    );
    const body = res.body as unknown as string;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.slice(1).split('\r\n')[0]).toBe(
      '"Rule key","Category","Severity","Section","Count"',
    );
    expect(body).toContain('"attendance.not_taken","ATTENDANCE","REMINDER","7-B","1"');
  });
});
