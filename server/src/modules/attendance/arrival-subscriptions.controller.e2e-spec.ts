import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_TENANT_ID,
} from '@test/constants';
import {
  assignTeacherToSection,
  createTeacherScopeFixture,
  TeacherScopeFixture,
} from '@test/helpers/teacher-scope.fixture';

const API = '/api/v1';
const STAFF = `${API}/attendance/arrival-subscriptions`;
const PORTAL = `${API}/portal/arrival-subscriptions`;

/**
 * [84.2] Arrival-notice subscription routes: teacher homeroom scope (404 outside, empty list
 * without a homeroom), guardian identity scope, LOCK permission, UUID/limit validation and
 * Idempotency-Key replay.
 *
 * Fixture: section A has a student + guardian, section B has another. The fixture teacher is
 * made CLASS_TEACHER of A only when a test calls `makeHomeroom()`.
 */
describe('Arrival subscriptions (E2E)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let fx: TeacherScopeFixture;
  let teacherToken: string;
  let adminToken: string;
  let parentToken: string;
  let parentUserId: string;
  const tag = randomUUID().slice(0, 8);

  const as = (
    method: 'get' | 'post' | 'put' | 'patch',
    url: string,
    token: string,
    role: UserRole,
  ) =>
    supertest(app.getHttpServer())
      [method](url)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);
  const asTeacher = (m: 'get' | 'post' | 'patch', url: string) =>
    as(m, url, teacherToken, UserRole.TEACHER);
  const asAdmin = (m: 'get' | 'post' | 'patch', url: string) =>
    as(m, url, adminToken, UserRole.ADMIN);
  const asParent = (m: 'get' | 'put', url: string) => as(m, url, parentToken, UserRole.PARENT);

  const makeHomeroom = () => assignTeacherToSection(dataSource, fx.teacherUserId, fx.sectionA);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);

    fx = await createTeacherScopeFixture(app, dataSource);
    teacherToken = await fx.login();
    const admin = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = admin.body.access_token;

    const email = `arrival-parent-${tag}@e2e.example`;
    const [user] = await dataSource.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, 'Arrival Parent', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH],
    );
    parentUserId = user.id;
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [parentUserId, SEED_TENANT_ID, UserRole.PARENT],
    );
    const parent = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    parentToken = parent.body.access_token;
  }, 120000);

  afterAll(async () => {
    await dataSource?.query(`DELETE FROM arrival_notice_subscriptions WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await dataSource?.query(`UPDATE guardians SET user_id = NULL WHERE user_id = $1`, [
      parentUserId,
    ]);
    await dataSource?.query(`DELETE FROM user_tenants WHERE user_id = $1`, [parentUserId]);
    await dataSource?.query(`DELETE FROM users WHERE id = $1`, [parentUserId]);
    await fx?.cleanup();
    await app?.close();
  });

  beforeEach(async () => {
    await dataSource.query(`DELETE FROM arrival_notice_subscriptions WHERE tenant_id = $1`, [
      SEED_TENANT_ID,
    ]);
    await fx.seed();
    // The parent is the guardian of student A only.
    await dataSource.query(`UPDATE guardians SET user_id = $1 WHERE id = $2`, [
      parentUserId,
      fx.guardianA,
    ]);
  });

  it('teacher without a homeroom (subject teacher only) gets an empty list', async () => {
    const res = await asTeacher('get', STAFF).expect(200);
    expect(res.body).toEqual([]);
  });

  it('teacher outside the section: list 404, create 404, row of another section 404', async () => {
    await makeHomeroom();
    await asTeacher('get', `${STAFF}?sectionId=${fx.sectionB}`).expect(404);
    await asTeacher('post', STAFF)
      .send({ student_id: fx.studentB, guardian_id: fx.guardianB, mode: 'ONCE' })
      .expect(404);

    const created = await asAdmin('post', STAFF)
      .send({ student_id: fx.studentB, guardian_id: fx.guardianB, mode: 'ONCE' })
      .expect(201);
    await asTeacher('patch', `${STAFF}/${created.body.id}`).send({ status: 'OFF' }).expect(404);
  });

  it('homeroom teacher adds a row (ACTIVE at once) and sees it in the list', async () => {
    await makeHomeroom();
    const created = await asTeacher('post', STAFF)
      .send({ student_id: fx.studentA, guardian_id: fx.guardianA, mode: 'RECURRING' })
      .expect(201);
    expect(created.body.status).toBe('ACTIVE');
    const list = await asTeacher('get', `${STAFF}?sectionId=${fx.sectionA}&status=ACTIVE`).expect(
      200,
    );
    expect(list.body.map((r: { id: string }) => r.id)).toEqual([created.body.id]);
  });

  it('guardian of another family child gets 404; own child works; list shows only own', async () => {
    await asParent('put', `${PORTAL}/${fx.studentB}`).send({ want: true }).expect(404);
    const put = await asParent('put', `${PORTAL}/${fx.studentA}`).send({ want: true }).expect(200);
    expect(put.body.status).toBe('REQUESTED');
    const mine = await asParent('get', PORTAL).expect(200);
    expect(mine.body.children.map((c: { student_id: string }) => c.student_id)).toEqual([
      fx.studentA,
    ]);
    expect(mine.body.children[0].subscription.id).toBe(put.body.id);
  });

  it('PATCH :id/lock as TEACHER is 403; as ADMIN it applies NEVER and blocks the guardian', async () => {
    await makeHomeroom();
    const created = await asAdmin('post', STAFF)
      .send({ student_id: fx.studentA, guardian_id: fx.guardianA, mode: 'ONCE' })
      .expect(201);
    await asTeacher('patch', `${STAFF}/${created.body.id}/lock`)
      .send({ lock: 'NEVER' })
      .expect(403);
    const locked = await asAdmin('patch', `${STAFF}/${created.body.id}/lock`)
      .send({ lock: 'NEVER' })
      .expect(200);
    expect(locked.body.status).toBe('OFF');
    await asParent('put', `${PORTAL}/${fx.studentA}`).send({ want: true }).expect(409);
  });

  it('non-UUID id is 400 and limit=500 is 400', async () => {
    await asAdmin('patch', `${STAFF}/not-a-uuid`).send({ status: 'OFF' }).expect(400);
    await asAdmin('patch', `${STAFF}/not-a-uuid/lock`).send({ lock: 'NONE' }).expect(400);
    await asParent('put', `${PORTAL}/not-a-uuid`).send({ want: true }).expect(400);
    await asAdmin('get', `${STAFF}?limit=500`).expect(400);
  });

  it('a replayed Idempotency-Key returns the same answer and creates one row', async () => {
    const key = `arrival-${tag}`;
    const send = () =>
      asParent('put', `${PORTAL}/${fx.studentA}`).set('Idempotency-Key', key).send({ want: true });
    const first = await send().expect(200);
    const second = await send().expect(200);
    expect(second.body.id).toBe(first.body.id);
    const [{ count }] = await dataSource.query(
      `SELECT COUNT(*)::int AS count FROM arrival_notice_subscriptions WHERE student_id = $1`,
      [fx.studentA],
    );
    expect(count).toBe(1);
  });
});
