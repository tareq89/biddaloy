import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';
import { insertJoinRequest } from './school-invite.service';

const API = '/api/v1/account/school-invites';
const NEW_SCHOOL_ID = '00000000-0000-4000-8000-0000000005b0';
const X_ID = '00000000-0000-4000-8000-0000000005b1';
const Y_ID = '00000000-0000-4000-8000-0000000005b2';
const X_EMAIL = 'invite-x-e2e@testschool.com';
const Y_EMAIL = 'invite-y-e2e@testschool.com';

function refreshCookie(res: supertest.Response): string {
  const headers = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const header = headers.find((c) => c.startsWith('__Host-refresh_token='));
  if (!header) throw new Error('No refresh_token cookie was set on this response');
  return decodeURIComponent(header.match(/^__Host-refresh_token=([^;]+)/)![1]);
}

describe('SchoolInvitesController (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tokenX: string;
  let tokenY: string;
  let cookieX: string;

  const request = (userId: string, role = UserRole.TEACHER) =>
    ds.transaction((m) =>
      insertJoinRequest(m, { userId, tenantId: NEW_SCHOOL_ID, role, createdByUserId: null }),
    );

  async function login(email: string) {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return { token: res.body.access_token as string, cookie: refreshCookie(res) };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.use(cookieParser());
    await app.init();
    ds = app.get(DataSource);

    await ds.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Invite E2E School', 'invite-e2e-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [NEW_SCHOOL_ID],
    );
    for (const [id, email] of [
      [X_ID, X_EMAIL],
      [Y_ID, Y_EMAIL],
    ]) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Invite E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, 'TEACHER', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID],
      );
    }
    const x = await login(X_EMAIL);
    tokenX = x.token;
    cookieX = x.cookie;
    tokenY = (await login(Y_EMAIL)).token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('no bearer token is 401', async () => {
    await supertest(app.getHttpServer()).get(API).expect(401);
  });

  it("GET lists only the caller's live requests", async () => {
    const mine = await request(X_ID);
    const theirs = await request(Y_ID);

    const res = await supertest(app.getHttpServer())
      .get(API)
      .set('Authorization', `Bearer ${tokenX}`)
      .expect(200);

    const ids = res.body.map((r: { id: string }) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
    expect(res.body[0]).toMatchObject({
      school_id: NEW_SCHOOL_ID,
      school_name: 'Invite E2E School',
    });
    await ds.query(`DELETE FROM auth_tokens WHERE user_id IN ($1, $2)`, [X_ID, Y_ID]);
  });

  it("user X gets 404 accepting user Y's request id", async () => {
    const theirs = await request(Y_ID);

    await supertest(app.getHttpServer())
      .post(`${API}/${theirs.id}/accept`)
      .set('Authorization', `Bearer ${tokenX}`)
      .expect(404);

    const rows = await ds.query(
      `SELECT 1 FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`,
      [X_ID, NEW_SCHOOL_ID],
    );
    expect(rows).toHaveLength(0);
    await ds.query(`DELETE FROM auth_tokens WHERE user_id = $1`, [Y_ID]);
  });

  it('decline removes the request from GET and creates no membership', async () => {
    const row = await request(Y_ID);

    await supertest(app.getHttpServer())
      .post(`${API}/${row.id}/decline`)
      .set('Authorization', `Bearer ${tokenY}`)
      .expect(204);

    const res = await supertest(app.getHttpServer())
      .get(API)
      .set('Authorization', `Bearer ${tokenY}`)
      .expect(200);
    expect(res.body).toEqual([]);
    const rows = await ds.query(
      `SELECT 1 FROM user_tenants WHERE user_id = $1 AND tenant_id = $2`,
      [Y_ID, NEW_SCHOOL_ID],
    );
    expect(rows).toHaveLength(0);
  });

  it('after accept, POST /auth/refresh returns a membership for the new school', async () => {
    const row = await request(X_ID);

    await supertest(app.getHttpServer())
      .post(`${API}/${row.id}/accept`)
      .set('Authorization', `Bearer ${tokenX}`)
      .expect(204);

    const refreshed = await supertest(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `__Host-refresh_token=${cookieX}`)
      .expect(200);
    const schools = refreshed.body.memberships.map((m: { tenantId: string }) => m.tenantId);
    expect(schools).toContain(NEW_SCHOOL_ID);
  });
});
