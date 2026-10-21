import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CommunicationMedium, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { StudentService } from '../students/students.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';

/** [13.3.4] Platform console trials: list fields + filter, extend, and who may do either. */
const API = '/api/v1';
const SUPER_ID = '00000000-0000-4000-8000-0000000d1301';
const SUPER_EMAIL = 'trials-e2e-super@testschool.example';
const LOCAL_SUPER_ID = '00000000-0000-4000-8000-0000000d1302';
const LOCAL_SUPER_EMAIL = 'trials-e2e-local-super@testschool.example';
const REASON = 'Customer asked for two more weeks';
const DAY = 24 * 60 * 60 * 1000;

describe('Platform trials E2E (13.3.4)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken = '';
  let superToken = '';
  let localSuperToken = '';
  const schools: string[] = [];
  // Platform calls act on the school in the path while the tenant header names the platform tenant,
  // so a suspended school's own header (which ContextGuard refuses) is never needed.
  let platformId = '';

  const login = async (email: string) =>
    (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;

  const newSchool = async (opts: { trialEnds: Date | null; expired?: boolean }) => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO schools (id, name, slug, trial_ends_at, status, status_reason, created_at, updated_at)
       VALUES ($1, 'Trials E2E', $2, $3, $4, $5, NOW(), NOW())`,
      [
        id,
        `trials-e2e-${id}`,
        opts.trialEnds,
        opts.expired ? 'SUSPENDED' : 'ACTIVE',
        opts.expired ? 'TRIAL_EXPIRED' : null,
      ],
    );
    for (const [uid, role] of [
      [SEED_ADMIN_USER_ID, UserRole.ADMIN],
      [LOCAL_SUPER_ID, UserRole.SUPER_ADMIN],
    ] as const) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [uid, id, role],
      );
    }
    schools.push(id);
    // JWTs embed memberships.
    adminToken = await login(SEED_ADMIN_EMAIL);
    localSuperToken = await login(LOCAL_SUPER_EMAIL);
    return id;
  };

  const list = (qs = '') =>
    supertest(app.getHttpServer())
      .get(`${API}/schools${qs}`)
      .set('Authorization', `Bearer ${superToken}`)
      .set('X-Tenant-ID', platformId)
      .set('X-Role', UserRole.SUPER_ADMIN);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    for (const [id, email] of [
      [SUPER_ID, SUPER_EMAIL],
      [LOCAL_SUPER_ID, LOCAL_SUPER_EMAIL],
    ]) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Trials E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
    }
    // Platform authority = SUPER_ADMIN on the platform tenant (found by slug outside production).
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       SELECT $1, 'Platform', 'default-school', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'default-school')`,
      [randomUUID()],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       SELECT $1, id, $2, NOW(), NOW() FROM schools WHERE slug = 'default-school'`,
      [SUPER_ID, UserRole.SUPER_ADMIN],
    );
    platformId = (await ds.query(`SELECT id FROM schools WHERE slug = 'default-school'`))[0].id;
    superToken = await login(SUPER_EMAIL);
  }, 60000);

  afterAll(async () => {
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [
      [SUPER_ID, LOCAL_SUPER_ID],
    ]);
    if (schools.length) {
      await ds.query(`DELETE FROM user_tenants WHERE tenant_id = ANY($1)`, [schools]);
    }
    await ds.query(`UPDATE schools SET trial_ends_at = NULL, seat_limit = NULL WHERE id = $1`, [
      SEED_TENANT_ID,
    ]);
    await app.close();
  });

  it('list shows trial fields and filters active / expired', async () => {
    const active = await newSchool({ trialEnds: new Date(Date.now() + 5 * DAY) });
    const expired = await newSchool({ trialEnds: new Date(Date.now() - DAY), expired: true });
    superToken = await login(SUPER_EMAIL);

    const all = (await list().expect(200)).body as { id: string }[];
    const row = all.find((s) => s.id === active)!;
    expect(row).toHaveProperty('trial_ends_at');
    expect(row).toHaveProperty('seat_limit');
    expect(row).toHaveProperty('country_code');
    expect(row).toHaveProperty('status_reason');

    const a = (await list('?trial=active').expect(200)).body.map((s: { id: string }) => s.id);
    expect(a).toContain(active);
    expect(a).not.toContain(expired);
    const e = (await list('?trial=expired').expect(200)).body.map((s: { id: string }) => s.id);
    expect(e).toContain(expired);
    expect(e).not.toContain(active);
    await list('?trial=bogus').expect(400);
  });

  it('manual reactivate is no longer blocked by a trial that ended', async () => {
    const id = await newSchool({ trialEnds: new Date(Date.now() - DAY), expired: true });
    await supertest(app.getHttpServer())
      .patch(`${API}/schools/${id}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .set('X-Tenant-ID', platformId)
      .set('X-Role', UserRole.SUPER_ADMIN)
      .send({ status: 'ACTIVE', reason: 'Back in business' })
      .expect(200);
  });

  // #2399 A1: an ended trial may still export (D16). A platform suspension on top of it must
  // close that, and the reserved reason cannot be typed in by hand to open it.
  it('re-suspending an expired-trial school for another reason closes its backup export', async () => {
    const id = await newSchool({ trialEnds: new Date(Date.now() - DAY), expired: true });
    const exportAsAdmin = () =>
      supertest(app.getHttpServer())
        .post(`${API}/backup/export`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', id)
        .set('X-Role', UserRole.ADMIN);
    const setStatus = (reason: string) =>
      supertest(app.getHttpServer())
        .patch(`${API}/schools/${id}/status`)
        .set('Authorization', `Bearer ${superToken}`)
        .set('X-Tenant-ID', platformId)
        .set('X-Role', UserRole.SUPER_ADMIN)
        .send({ status: 'SUSPENDED', reason });

    await exportAsAdmin().expect(202);
    await setStatus('TRIAL_EXPIRED').expect(400);
    await setStatus('Fraud / legal hold').expect(200);

    const res = await exportAsAdmin().expect(403);
    expect(res.body.details).toEqual({ code: 'TENANT_SUSPENDED' });
    const [school] = await ds.query(`SELECT status_reason FROM schools WHERE id = $1`, [id]);
    expect(school.status_reason).toBe('Fraud / legal hold');
  });

  it('the other platform school routes refuse a tenant-local SUPER_ADMIN with 403', async () => {
    const id = await newSchool({ trialEnds: new Date(Date.now() + DAY) });
    const asLocalSuper = (req: supertest.Test) =>
      req
        .set('Authorization', `Bearer ${localSuperToken}`)
        .set('X-Tenant-ID', id)
        .set('X-Role', UserRole.SUPER_ADMIN);
    const http = supertest(app.getHttpServer());

    await asLocalSuper(http.get(`${API}/schools`)).expect(403);
    await asLocalSuper(http.get(`${API}/schools/${id}/stats`)).expect(403);
    await asLocalSuper(http.patch(`${API}/schools/${id}/status`))
      .send({ status: 'SUSPENDED', reason: 'Tenant-local attempt' })
      .expect(403);
    expect((await ds.query(`SELECT status FROM schools WHERE id = $1`, [id]))[0].status).toBe(
      'ACTIVE',
    );
  });

  describe('POST /schools/:id/revive [49.15]', () => {
    const reviveBody = { reason: 'School called, starting next week' };

    /** An ordinary school the idle job paused; `deletedDaysAgo` also soft-deletes it. */
    const idleSchool = async (deletedDaysAgo: number | null = null, reason = 'IDLE') => {
      const id = await newSchool({ trialEnds: null });
      await ds.query(
        `UPDATE schools SET status = 'SUSPENDED', status_reason = $2, status_changed_at = NOW(),
                deleted_at = CASE WHEN $3::int IS NULL THEN NULL ELSE NOW() - ($3::int * interval '1 day') END
          WHERE id = $1`,
        [id, reason, deletedDaysAgo],
      );
      return id;
    };
    const revive = (
      who: 'admin' | 'super' | 'localSuper',
      id: string,
      body: object = reviveBody,
    ) => {
      const [token, role, tenant] =
        who === 'admin'
          ? [adminToken, UserRole.ADMIN, id]
          : who === 'super'
            ? [superToken, UserRole.SUPER_ADMIN, platformId]
            : [localSuperToken, UserRole.SUPER_ADMIN, id];
      return supertest(app.getHttpServer())
        .post(`${API}/schools/${id}/revive`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenant)
        .set('X-Role', role)
        .send(body);
    };
    const row = async (id: string) =>
      (
        await ds.query(`SELECT status, status_reason, deleted_at FROM schools WHERE id = $1`, [id])
      )[0];

    it('refuses a school ADMIN (also on its own school) and a tenant-local SUPER_ADMIN with 403', async () => {
      const id = await idleSchool();
      await revive('admin', id).expect(403);
      await revive('localSuper', id).expect(403);
      // Still paused: neither caller changed anything.
      expect((await row(id)).status).toBe('SUSPENDED');
    });

    it('refuses a request with no X-Tenant-ID', async () => {
      const id = await idleSchool();
      const res = await supertest(app.getHttpServer())
        .post(`${API}/schools/${id}/revive`)
        .set('Authorization', `Bearer ${superToken}`)
        .send(reviveBody);
      expect([400, 401, 403]).toContain(res.status);
      expect((await row(id)).status).toBe('SUSPENDED');
    });

    it('validates the id and the body, and answers 404 for an unknown school', async () => {
      const id = await idleSchool();
      await revive('super', 'not-a-uuid').expect(400);
      await revive('super', id, {}).expect(400);
      await revive('super', id, { reason: 'abc' }).expect(400);
      await revive('super', id, { reason: 'x'.repeat(501) }).expect(400);
      await revive('super', id, { ...reviveBody, extra: 1 }).expect(400);
      const res = await revive('super', randomUUID()).expect(404);
      // Rule 23: the unknown id is not echoed back.
      expect(JSON.stringify(res.body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    });

    it('revives a paused IDLE school as the platform SUPER_ADMIN', async () => {
      const id = await idleSchool();
      const res = await revive('super', id).expect(200);
      expect(res.body).toMatchObject({ id, status: 'ACTIVE', status_reason: null });
      expect(await row(id)).toMatchObject({ status: 'ACTIVE', status_reason: null });
      const audit = await ds.query(
        `SELECT action FROM audit_logs WHERE entity_id = $1 AND new_values->>'event' = 'IDLE_REVIVED'`,
        [id],
      );
      expect(audit.map((a: { action: string }) => a.action)).toEqual(['REACTIVATE']);
    });

    it('revives a school soft-deleted 10 days ago, and refuses one deleted 100 days ago', async () => {
      const recent = await idleSchool(10);
      await revive('super', recent).expect(200);
      expect((await row(recent)).deleted_at).toBeNull();

      const old = await idleSchool(100);
      const res = await revive('super', old).expect(409);
      expect(res.body.details?.code ?? res.body.message?.details?.code).toBe(
        'REVIVE_WINDOW_PASSED',
      );
      expect((await row(old)).deleted_at).not.toBeNull();
      // A member of a soft-deleted school can still log in (it used to be a 500).
      await login(SEED_ADMIN_EMAIL);
    });

    it('does not reopen a suspension that was not an idle one', async () => {
      const id = await idleSchool(null, 'Fees dispute with the school');
      await revive('super', id).expect(409);
      expect((await row(id)).status).toBe('SUSPENDED');
    });

    it('cuts old access tokens off (401) and shows the IDLE reason to a fresh one (403)', async () => {
      const id = await idleSchool();
      const oldToken = adminToken; // minted before the cut-off below
      try {
        await ds.query(`UPDATE users SET tokens_valid_after = $2 WHERE id = $1`, [
          SEED_ADMIN_USER_ID,
          new Date(), // app clock, the same source as the token's iat
        ]);
        const http = supertest(app.getHttpServer());
        await http
          .get(`${API}/students`)
          .set('Authorization', `Bearer ${oldToken}`)
          .set('X-Tenant-ID', id)
          .set('X-Role', UserRole.ADMIN)
          .expect(401);

        // A fresh login after the cut-off still gets in, then ContextGuard names the reason.
        await new Promise((r) => setTimeout(r, 20));
        const fresh = await login(SEED_ADMIN_EMAIL);
        const res = await http
          .get(`${API}/students`)
          .set('Authorization', `Bearer ${fresh}`)
          .set('X-Tenant-ID', id)
          .set('X-Role', UserRole.ADMIN)
          .expect(403);
        const details = res.body.details ?? res.body.message?.details;
        expect(details).toMatchObject({ code: 'TENANT_SUSPENDED', reason: 'IDLE' });
      } finally {
        // The seed admin is shared with other specs.
        await ds.query(`UPDATE users SET tokens_valid_after = NULL WHERE id = $1`, [
          SEED_ADMIN_USER_ID,
        ]);
      }
    });
  });
});
