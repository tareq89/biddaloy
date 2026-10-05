import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SocialTicketService } from '../auth/social/social-ticket.service';
import { ProvisioningService } from '../schools/provisioning/provisioning.service';
import { randomUUID } from 'node:crypto';

const BASE = '/api/v1/auth/register';

describe('RegistrationController (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let n = 0;

  /** Unique contacts per registration so tests never collide on shared Redis cooldowns or user rows. */
  function details(over: Record<string, unknown> = {}) {
    n += 1;
    const suffix = `${Date.now()}${n}`.slice(-8);
    return {
      admin_name: 'Rahim Uddin',
      school_name: `Registration Test School ${suffix}`,
      country_code: 'BD',
      address: '1 Test Road, Dhaka',
      phone: `0171${suffix.slice(-7)}`,
      email: `reg-${suffix}@example.com`,
      terms_accepted: true,
      captcha_token: 'ok',
      ...over,
    };
  }

  const start = (body: object) => supertest(app.getHttpServer()).post(`${BASE}/start`).send(body);
  const verify = (body: object, cookie?: string) => {
    const req = supertest(app.getHttpServer()).post(`${BASE}/verify`);
    if (cookie) req.set('Cookie', cookie);
    return req.send(body);
  };

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';
    process.env.ACCOUNT_ACCESS_ECHO_SECRETS = 'true';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.use(cookieParser());
    await app.init();
    ds = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register/start', () => {
    it('answers 202 with the same shape whether or not the phone already has an account', async () => {
      const known = details();
      await ds.query(
        `INSERT INTO users (phone, full_name, status) VALUES ($1, 'Known Person', 'ACTIVE')`,
        [known.phone],
      );
      const a = await start(known).expect(202);
      const b = await start(details()).expect(202);
      // Nothing in the body may differ in kind between a known and an unknown number.
      expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
      expect(a.body).toMatchObject({ channel: 'sms', resend_in: 60 });
      expect(b.body).toMatchObject({ channel: 'sms', resend_in: 60 });
    });

    it('sends the code by email when the phone prefix is not on the SMS list', async () => {
      const res = await start(details({ phone: '+14155550123' })).expect(202);
      expect(res.body.channel).toBe('email');
    });

    it('rejects when the terms are not accepted', async () => {
      await start(details({ terms_accepted: false })).expect(400);
    });

    it('honours the 60 second cooldown on resend', async () => {
      const first = await start(details()).expect(202);
      await supertest(app.getHttpServer())
        .post(`${BASE}/resend`)
        .send({ registration_id: first.body.registration_id })
        .expect(429);
    });
  });

  describe('POST /auth/register/verify', () => {
    it('creates a school in trial with the registrant as its only ADMIN and signs them in', async () => {
      const d = details();
      const s = await start(d).expect(202);
      const res = await verify({
        registration_id: s.body.registration_id,
        otp: s.body.debug.otp,
      }).expect(200);

      expect(res.body.access_token).toBeTruthy();
      expect(res.body).toMatchObject({ needs_password: true, password_required: true });
      const cookies = (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(cookies.some((c) => c.startsWith('__Host-refresh_token='))).toBe(true);

      const [school] = await ds.query(
        `SELECT id, trial_ends_at, seat_limit, onboarding, country_code, address FROM schools WHERE name = $1`,
        [d.school_name],
      );
      expect(school.trial_ends_at).not.toBeNull();
      expect(school.seat_limit).toBe(10);
      expect(school.onboarding).toBeNull();
      expect(school.country_code).toBe('BD');
      const admins = await ds.query(
        `SELECT u.id, u.phone_verified_at, u.email_verified_at FROM user_tenants m
           JOIN users u ON u.id = m.user_id WHERE m.tenant_id = $1 AND m.role = 'ADMIN'`,
        [school.id],
      );
      expect(admins).toHaveLength(1);
      // The code went to the phone, so only the phone is marked proven.
      expect(admins[0].phone_verified_at).not.toBeNull();
      expect(admins[0].email_verified_at).toBeNull();
      const audit = await ds.query(
        `SELECT new_values FROM audit_logs WHERE entity_type = 'Registration' AND entity_id = $1`,
        [school.id],
      );
      expect(audit[0].new_values).toMatchObject({ country_code: 'BD' });
      // No invitation is created: the code already proved the contact.
      const invites = await ds.query(`SELECT 1 FROM auth_tokens WHERE tenant_id = $1`, [school.id]);
      expect(invites).toHaveLength(0);
    });

    it('never produces a second school when the same registration is verified again', async () => {
      const d = details();
      const s = await start(d).expect(202);
      const body = { registration_id: s.body.registration_id, otp: s.body.debug.otp };
      await verify(body).expect(200);
      await verify(body).expect(410);
      const rows = await ds.query(`SELECT 1 FROM schools WHERE name = $1`, [d.school_name]);
      expect(rows).toHaveLength(1);
    });

    it('locks the registration after five wrong codes', async () => {
      const s = await start(details()).expect(202);
      const wrong = s.body.debug.otp === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i += 1) {
        await verify({ registration_id: s.body.registration_id, otp: wrong }).expect(400);
      }
      await verify({ registration_id: s.body.registration_id, otp: wrong }).expect(429);
      // Even the right code is refused once locked.
      await verify({ registration_id: s.body.registration_id, otp: s.body.debug.otp }).expect(429);
    });

    it('answers 410 for an unknown or expired registration', async () => {
      await verify({ registration_id: randomUUID(), otp: '123456' }).expect(410);
    });

    it('attaches the school to an existing user instead of creating a second user row', async () => {
      const d = details();
      const [{ id: userId }] = await ds.query(
        `INSERT INTO users (phone, email, full_name, status) VALUES ($1, $2, 'Existing Head', 'ACTIVE') RETURNING id`,
        [d.phone, d.email],
      );
      const s = await start(d).expect(202);
      await verify({ registration_id: s.body.registration_id, otp: s.body.debug.otp }).expect(200);
      const users = await ds.query(`SELECT id FROM users WHERE phone = $1`, [d.phone]);
      expect(users).toEqual([{ id: userId }]);
      const mem = await ds.query(
        `SELECT 1 FROM user_tenants WHERE user_id = $1 AND role = 'ADMIN'`,
        [userId],
      );
      expect(mem).toHaveLength(1);

      // A second school while the first trial is open is refused (D30).
      const again = { ...d, school_name: `${d.school_name} Two` };
      const s2 = await start(again).expect(202);
      const res = await verify({
        registration_id: s2.body.registration_id,
        otp: s2.body.debug.otp,
      }).expect(409);
      expect(res.body.details.code).toBe('TRIAL_ALREADY_OPEN');
    });

    it("refuses to sign in as someone else's account through the unproven contact", async () => {
      // The attacker proves a fresh phone but types the victim's email. Without this guard the
      // victim's user would be reused and the attacker would get a session for it.
      const victimEmail = `victim-${Date.now()}@example.com`;
      await ds.query(
        `INSERT INTO users (email, full_name, status) VALUES ($1, 'Victim', 'ACTIVE')`,
        [victimEmail],
      );
      const d = details({ email: victimEmail });
      const s = await start(d).expect(202);
      const res = await verify({
        registration_id: s.body.registration_id,
        otp: s.body.debug.otp,
      }).expect(409);
      expect(res.body.details.code).toBe('CONTACT_IN_USE');
      const schools = await ds.query(`SELECT 1 FROM schools WHERE name = $1`, [d.school_name]);
      expect(schools).toHaveLength(0);
    });

    it('links the Google account from the ticket cookie and then needs no password', async () => {
      const ticketId = await app.get(SocialTicketService).issue({
        provider: 'google',
        subject: `sub-${randomUUID()}`,
        email: 'g@example.com',
        name: 'G',
      });
      const d = details();
      const s = await start(d).expect(202);
      const res = await verify(
        { registration_id: s.body.registration_id, otp: s.body.debug.otp },
        `social_ticket=${ticketId}`,
      ).expect(200);
      expect(res.body).toMatchObject({ needs_password: true, password_required: false });
      const ids = await ds.query(
        `SELECT 1 FROM user_identities i JOIN users u ON u.id = i.user_id WHERE u.phone = $1`,
        [d.phone],
      );
      expect(ids).toHaveLength(1);
      // The ticket is single-use.
      expect(await app.get(SocialTicketService).consume(ticketId)).toBeNull();
    });
  });

  describe('atomicity', () => {
    it('leaves no school, user or membership behind when a step after provisioning fails', async () => {
      const key = randomUUID();
      const email = `atomic-${Date.now()}@example.com`;
      await expect(
        app.get(ProvisioningService, { strict: false }).provision(
          {
            name: 'Atomic Failure School',
            slug: `atomic-${key.slice(0, 8)}`,
            admin: { name: 'Nobody', email },
            idempotency_key: key,
            send_invitation: false,
          },
          null,
          {
            inTransaction: async () => {
              throw new Error('forced');
            },
          },
        ),
      ).rejects.toThrow('forced');
      expect(await ds.query(`SELECT 1 FROM schools WHERE name = 'Atomic Failure School'`)).toEqual(
        [],
      );
      expect(await ds.query(`SELECT 1 FROM users WHERE email = $1`, [email])).toEqual([]);
    });
  });
});
