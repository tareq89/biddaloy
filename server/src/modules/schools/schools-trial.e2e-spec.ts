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

  const patchTrial = (who: 'admin' | 'super' | 'localSuper', id: string, body: object) => {
    const [token, role, tenant] =
      who === 'admin'
        ? [adminToken, UserRole.ADMIN, id]
        : who === 'super'
          ? [superToken, UserRole.SUPER_ADMIN, platformId]
          : [localSuperToken, UserRole.SUPER_ADMIN, id];
    return supertest(app.getHttpServer())
      .patch(`${API}/schools/${id}/trial`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenant)
      .set('X-Role', role)
      .send(body);
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

  it('extend moves the date and writes an audit row with the reason', async () => {
    const end = new Date(Date.now() + 5 * DAY);
    const id = await newSchool({ trialEnds: end });
    const res = await patchTrial('super', id, { days: 10, reason: REASON }).expect(200);
    expect(new Date(res.body.trial_ends_at).getTime()).toBeCloseTo(end.getTime() + 10 * DAY, -4);
    const rows = await ds.query(
      `SELECT new_values FROM audit_logs WHERE entity_type = 'Trial' AND entity_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].new_values.reason).toBe(REASON);
  });

  it('extending an expired trial reactivates the school and the admin is let in again', async () => {
    const id = await newSchool({ trialEnds: new Date(Date.now() - DAY), expired: true });
    const students = () =>
      supertest(app.getHttpServer())
        .get(`${API}/students`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', id)
        .set('X-Role', UserRole.ADMIN);
    await students().expect(403);

    await patchTrial('super', id, { days: 7, reason: REASON }).expect(200);
    await students().expect(200);
  });

  it('manual reactivate of an expired-trial school is refused until the trial is extended', async () => {
    const id = await newSchool({ trialEnds: new Date(Date.now() - DAY), expired: true });
    const res = await supertest(app.getHttpServer())
      .patch(`${API}/schools/${id}/status`)
      .set('Authorization', `Bearer ${superToken}`)
      .set('X-Tenant-ID', platformId)
      .set('X-Role', UserRole.SUPER_ADMIN)
      .send({ status: 'ACTIVE', reason: 'Back in business' })
      .expect(409);
    expect(res.body.details.code).toBe('TRIAL_EXPIRED');
  });

  it('refuses ADMIN and tenant-local SUPER_ADMIN with 403', async () => {
    const id = await newSchool({ trialEnds: new Date(Date.now() + DAY) });
    await patchTrial('admin', id, { days: 7, reason: REASON }).expect(403);
    await patchTrial('localSuper', id, { days: 7, reason: REASON }).expect(403);
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

  it('validates the body and refuses NOT_IN_TRIAL', async () => {
    const id = await newSchool({ trialEnds: new Date(Date.now() + DAY) });
    await patchTrial('super', id, { days: 0, reason: REASON }).expect(400);
    await patchTrial('super', id, { days: 366, reason: REASON }).expect(400);
    await patchTrial('super', id, { days: 5, reason: 'short' }).expect(400);
    await patchTrial('super', id, { days: 5, reason: REASON, seat_limit: -1 }).expect(400);
    await patchTrial('super', id, { days: 5, reason: REASON, extra: 1 }).expect(400);

    const noTrial = await newSchool({ trialEnds: null });
    const res = await patchTrial('super', noTrial, { days: 5, reason: REASON }).expect(409);
    expect(res.body.details.code).toBe('NOT_IN_TRIAL');
  });

  it('seat_limit can never be set below the current ACTIVE students', async () => {
    await ds.query(`UPDATE schools SET trial_ends_at = $2 WHERE id = $1`, [
      SEED_TENANT_ID,
      new Date(Date.now() + DAY),
    ]);
    const students = app.get(StudentService);
    const s = await students.create(
      {
        full_name: 'Seat Floor',
        class_section_id: SEED_SECTION_1_ID,
        preferred_communication: CommunicationMedium.SMS,
      },
      SEED_TENANT_ID,
    );
    try {
      const used = Number(
        (
          await ds.query(
            `SELECT count(*)::int AS n FROM students WHERE tenant_id = $1 AND deleted_at IS NULL AND enrollment_status = 'ACTIVE'`,
            [SEED_TENANT_ID],
          )
        )[0].n,
      );
      const low = await patchTrial('super', SEED_TENANT_ID, {
        days: 5,
        reason: REASON,
        seat_limit: used - 1,
      }).expect(409);
      expect(low.body.details.code).toBe('SEAT_LIMIT_BELOW_USAGE');
      await patchTrial('super', SEED_TENANT_ID, {
        days: 5,
        reason: REASON,
        seat_limit: used,
      }).expect(200);
    } finally {
      await ds.query('DELETE FROM student_guardians WHERE student_id = $1', [s.id]);
      await ds.query('DELETE FROM enrollments WHERE student_id = $1', [s.id]);
      await ds.query('DELETE FROM students WHERE id = $1', [s.id]);
    }
  });
});
