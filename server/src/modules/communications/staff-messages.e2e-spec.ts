import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { UserRole } from '@biddaloy/shared';

/**
 * [80.1.05] POST /communications/staff/preview and POST /communications/staff.
 * Both routes: ADMIN / EXECUTIVE school-wide, TEACHER only with coordinator scope (no classes
 * here, so a fixed 400), every other role 403; missing or wrong X-Tenant-ID; non-UUID ids 400;
 * an Idempotency-Key replays the first answer instead of sending twice.
 */
describe('Staff messages E2E', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tag = randomUUID().slice(0, 8);
  const tokens: Record<string, string> = {};
  const PREVIEW = '/api/v1/communications/staff/preview';
  const SEND = '/api/v1/communications/staff';

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }
  async function addUser(key: string, role: UserRole, phone: string | null): Promise<void> {
    const email = `${key}-${tag}@staff-msg-e2e.example`;
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, phone, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [email, SEED_ADMIN_PASSWORD_HASH, `E2E ${key}`, phone],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, SEED_TENANT_ID, role],
    );
    tokens[key] = await login(email);
  }
  const body = (message: string, extra: object = {}) => ({
    audience: { roles: [UserRole.OFFICE_STAFF] },
    message,
    medium: 'SMS',
    ...extra,
  });
  const post = (url: string, who: string) =>
    supertest(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${tokens[who]}`)
      .set('X-Tenant-ID', SEED_TENANT_ID);

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    tokens.admin = await login(SEED_ADMIN_EMAIL);
    await addUser('executive', UserRole.EXECUTIVE, null);
    await addUser('teacher', UserRole.TEACHER, null);
    await addUser('accountant', UserRole.ACCOUNTANT, null);
    await addUser('office', UserRole.OFFICE_STAFF, '+8801711000001');
    await addUser('exam', UserRole.EXAM_CONTROLLER, null);
    await addUser('committee', UserRole.COMMITTEE, null);
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  describe.each([
    ['preview', PREVIEW, 200],
    ['send', SEND, 201],
  ])('%s', (_name, url, okStatus) => {
    it('ADMIN and EXECUTIVE are allowed', async () => {
      await post(url, 'admin')
        .send(body(`admin ${url} ${tag}`))
        .expect(okStatus);
      await post(url, 'executive')
        .send(body(`exec ${url} ${tag}`))
        .expect(okStatus);
    });

    it('TEACHER without coordinator classes gets the fixed 400', async () => {
      const res = await post(url, 'teacher')
        .send(body('hello', { audience: { roles: [UserRole.TEACHER] } }))
        .expect(400);
      expect(res.body.message).toBe('No staff to message in your classes.');
    });

    it.each(['accountant', 'office', 'exam', 'committee'])('%s is 403', async (who) => {
      await post(url, who).send(body('hello')).expect(403);
    });

    it('requires X-Tenant-ID, and refuses an unknown one', async () => {
      await supertest(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send(body('hello'))
        .expect(401);
      await supertest(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .set('X-Tenant-ID', randomUUID())
        .send(body('hello'))
        .expect(401);
    });

    it('non-UUID userIds and designationIds are 400', async () => {
      await post(url, 'admin')
        .send(body('hello', { audience: { userIds: ['not-a-uuid'] } }))
        .expect(400);
      await post(url, 'admin')
        .send(body('hello', { audience: { designationIds: ['nope'] } }))
        .expect(400);
    });

    it('whitespace-only message is 400 with a fixed sentence', async () => {
      const res = await post(url, 'admin').send(body('   ')).expect(400);
      expect(JSON.stringify(res.body)).toContain('Write a message.');
    });

    it('WhatsApp without a template is 400', async () => {
      await post(url, 'admin')
        .send(body('hello', { medium: 'WHATSAPP' }))
        .expect(400);
    });
  });

  it('the preview writes no batch and no log', async () => {
    const before = await ds.query(`SELECT count(*) FROM reminder_batches`);
    const res = await post(PREVIEW, 'admin')
      .send(body(`preview only ${tag}`))
      .expect(200);
    expect(res.body).toMatchObject({ segments_each: 1, whatsapp_template: null });
    expect(res.body.with_phone).toBeGreaterThanOrEqual(1);
    expect(await ds.query(`SELECT count(*) FROM reminder_batches`)).toEqual(before);
  });

  it('a repeated Idempotency-Key replays the first answer and sends once', async () => {
    const key = `staff-${tag}`;
    const text = `replay ${tag}`;
    const first = await post(SEND, 'admin')
      .set('Idempotency-Key', key)
      .send(body(text))
      .expect(201);
    const second = await post(SEND, 'admin')
      .set('Idempotency-Key', key)
      .send(body(text))
      .expect(201);
    expect(second.body.batch_id).toBe(first.body.batch_id);
    const batches = await ds.query(
      `SELECT count(*) FROM reminder_batches WHERE message_template = $1`,
      [text],
    );
    expect(Number(batches[0].count)).toBe(1);
  });

  it('the same text and audience again within a minute is a 409', async () => {
    const text = `dup ${tag}`;
    await post(SEND, 'admin').send(body(text)).expect(201);
    const res = await post(SEND, 'admin').send(body(text)).expect(409);
    expect(res.body.message).toBe('This message was just sent to the same people. Wait a minute.');
    expect(JSON.stringify(res.body)).not.toContain(text);
  });
});
