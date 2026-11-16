import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { ImpersonationEntryKind, SupportAccessMode, UserRole, UserStatus } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { hashPassword } from '../auth/password-hash';
import { ImpersonationSessionService } from '../support-access/sessions/impersonation-session.service';
import { ImpersonationCodeService } from '../support-access/exchange/impersonation-code.service';

/** [59.2.01] /legal/status and /legal/accept over real HTTP. */
describe('LegalController (e2e)', () => {
  const API = '/api/v1';
  const PASSWORD = 'Legal-pass-12345';
  let app: INestApplication;
  let ds: DataSource;
  let schoolA: string;
  let schoolB: string;
  let admin: { id: string; token: string };
  let teacher: { id: string; token: string };

  const http = () => supertest(app.getHttpServer());
  const as = (token: string, tenant?: string) => ({
    Authorization: `Bearer ${token}`,
    ...(tenant ? { 'X-Tenant-ID': tenant } : {}),
  });

  async function makeSchool(label: string) {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, `Legal ${label}`, `legal-${id.slice(0, 8)}`],
    );
    return id;
  }

  async function makeUser(label: string, memberships: [string, UserRole][]) {
    const s = randomUUID().slice(0, 8);
    const email = `legal-${label}-${s}@biddaloy.test`;
    const [row] = await ds.query(
      `INSERT INTO users (email, full_name, status, password_hash, email_verified_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
      [email, `Legal ${label}`, UserStatus.ACTIVE, await hashPassword(PASSWORD)],
    );
    for (const [tenant, role] of memberships) {
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
        [row.id, tenant, role],
      );
    }
    const login = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: PASSWORD })
      .expect(200);
    return { id: row.id as string, token: login.body.access_token as string };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    schoolA = await makeSchool('A');
    schoolB = await makeSchool('B');
    admin = await makeUser('admin', [
      [schoolA, UserRole.ADMIN],
      [schoolB, UserRole.ADMIN],
    ]);
    teacher = await makeUser('teacher', [[schoolA, UserRole.TEACHER]]);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('rejects a missing or invalid X-Tenant-ID on both routes (401, as other identity routes)', async () => {
    await http().get(`${API}/legal/status`).set(as(admin.token)).expect(401);
    await http().get(`${API}/legal/status`).set(as(admin.token, 'not-a-uuid')).expect(401);
    await http()
      .post(`${API}/legal/accept`)
      .set(as(admin.token))
      .send({ documents: ['terms'], versions: { terms: '1.0', privacy: '1.0', dpa: '1.0' } })
      .expect(401);
    await http()
      .post(`${API}/legal/accept`)
      .set(as(admin.token, 'not-a-uuid'))
      .send({ documents: ['terms'], versions: { terms: '1.0', privacy: '1.0', dpa: '1.0' } })
      .expect(401);
  });

  it('rejects a call with no token', async () => {
    await http().get(`${API}/legal/status`).set('X-Tenant-ID', schoolA).expect(401);
  });

  it('admin flow: status, accept, status shows nothing pending; school B is untouched', async () => {
    const before = await http()
      .get(`${API}/legal/status`)
      .set(as(admin.token, schoolA))
      .expect(200);
    expect(before.body.pending).toEqual(['terms', 'privacy', 'dpa']);

    const done = await http()
      .post(`${API}/legal/accept`)
      .set(as(admin.token, schoolA))
      .send({
        documents: ['terms', 'privacy', 'dpa'],
        versions: { terms: '1.0', privacy: '1.0', dpa: '1.0' },
      })
      .expect(200);
    expect(done.body).toEqual({ pending: [] });
    const after = await http().get(`${API}/legal/status`).set(as(admin.token, schoolA)).expect(200);
    expect(after.body.pending).toEqual([]);

    // Tenant isolation: accepting in school A does not clear school B.
    const other = await http().get(`${API}/legal/status`).set(as(admin.token, schoolB)).expect(200);
    expect(other.body.pending).toEqual(['terms', 'privacy', 'dpa']);
  });

  it('a teacher owes nothing', async () => {
    const res = await http().get(`${API}/legal/status`).set(as(teacher.token, schoolA)).expect(200);
    expect(res.body.pending).toEqual([]);
  });

  it('rejects an unknown document and an empty list with 400', async () => {
    await http()
      .post(`${API}/legal/accept`)
      .set(as(admin.token, schoolB))
      .send({ documents: ['bogus'], versions: { terms: '1.0', privacy: '1.0', dpa: '1.0' } })
      .expect(400);
    await http()
      .post(`${API}/legal/accept`)
      .set(as(admin.token, schoolB))
      .send({ documents: [], versions: { terms: '1.0', privacy: '1.0', dpa: '1.0' } })
      .expect(400);
  });

  it('rejects a version the user did not read with 409', async () => {
    await http()
      .post(`${API}/legal/accept`)
      .set(as(admin.token, schoolB))
      .send({ documents: ['terms'], versions: { terms: '0.9' } })
      .expect(409);
  });

  it('a Login as session gets 403 IMPERSONATION_DENIED on accept and no row is written (D37)', async () => {
    const [{ id: platformAdminId }] = await ds.query(
      `INSERT INTO users (email, full_name, status) VALUES ($1, 'Legal owner', 'ACTIVE') RETURNING id`,
      [`legal-owner-${randomUUID().slice(0, 8)}@biddaloy.test`],
    );
    await ds.query(`INSERT INTO platform_admins (user_id) VALUES ($1)`, [platformAdminId]);
    await ds.query(
      `UPDATE schools SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{supportAccess}', $2::jsonb) WHERE id = $1`,
      [
        schoolB,
        JSON.stringify({
          mode: SupportAccessMode.ALLOWED,
          confirmedAt: new Date().toISOString(),
          confirmedBy: null,
          textVersion: 99,
        }),
      ],
    );
    const row = await app.get(ImpersonationSessionService).create({
      platformAdminId,
      schoolId: schoolB,
      targetUserId: admin.id,
      role: UserRole.ADMIN,
      reason: 'Legal e2e check',
      viewOnly: false,
      entryKind: ImpersonationEntryKind.NORMAL,
    });
    const code = await app.get(ImpersonationCodeService).issue(row.id);
    const ex = await http().post(`${API}/auth/impersonation/exchange`).send({ code }).expect(200);

    const res = await http()
      .post(`${API}/legal/accept`)
      .set(as(ex.body.access_token, schoolB))
      .send({ documents: ['terms'], versions: { terms: '1.0', privacy: '1.0', dpa: '1.0' } })
      .expect(403);
    expect(JSON.stringify(res.body)).toContain('IMPERSONATION_DENIED');
    const rows = await ds.query(`SELECT 1 FROM legal_acceptances WHERE tenant_id = $1`, [schoolB]);
    expect(rows).toHaveLength(0);
  }, 30000);
});
