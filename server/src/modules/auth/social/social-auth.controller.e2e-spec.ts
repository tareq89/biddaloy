import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import supertest = require('supertest');
import cookieParser = require('cookie-parser');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SocialProvider } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';
import { AuthService } from '../auth.service';
import { SOCIAL_PROVIDERS, type SocialProviderClient } from './providers/social-provider';
import { SocialTicketService } from './social-ticket.service';

const API = '/api/v1';

/** Stands in for Google/Facebook: no network, subject chosen by the test. */
function stubProvider(name: SocialProvider): SocialProviderClient & {
  configured: boolean;
  nextSubject: string;
  nextEmail: string;
} {
  return {
    name,
    configured: true,
    nextSubject: 'sub-default',
    nextEmail: 'person@example.com',
    isConfigured() {
      return this.configured;
    },
    authorizeUrl: ({ state }) => `https://provider.test/auth?state=${state}`,
    async exchange() {
      return { subject: this.nextSubject, email: this.nextEmail, name: 'Person' };
    },
  };
}

/** E2E for /auth/social/* [13.2.4] with the provider stubbed. */
describe('SocialAuthController (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const google = stubProvider(SocialProvider.GOOGLE);
  const facebook = stubProvider(SocialProvider.FACEBOOK);

  const NOLOGIN_ID = '00000000-0000-4000-8000-0000000013a1';
  const SUB_PREFIX = 'e2e-social-';

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SOCIAL_PROVIDERS)
      .useValue([google, facebook])
      .compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    google.configured = true;
    await dataSource.query(`DELETE FROM user_identities WHERE subject LIKE $1`, [`${SUB_PREFIX}%`]);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM user_identities WHERE subject LIKE $1`, [`${SUB_PREFIX}%`]);
    await dataSource.query(`DELETE FROM users WHERE id = $1`, [NOLOGIN_ID]);
    await app.close();
  });

  const http = () => supertest(app.getHttpServer());
  const stateOf = (location: string) => new URL(location).searchParams.get('state') as string;

  async function adminToken(): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function startLogin(provider = 'google', intent = 'login'): Promise<string> {
    const res = await http()
      .get(`${API}/auth/social/${provider}/start?intent=${intent}`)
      .expect(302);
    return stateOf(res.headers.location);
  }

  const callback = (state: string, provider = 'google', cookie: string | null = state) =>
    http()
      .get(`${API}/auth/social/${provider}/callback?code=abc&state=${state}`)
      .set('Cookie', cookie ? [`social_state=${cookie}`] : []);

  async function connect(subject: string, token: string): Promise<string> {
    google.nextSubject = subject;
    const res = await http()
      .post(`${API}/auth/social/google/link-start`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const state = stateOf(res.body.url);
    return (await callback(state)).headers.location;
  }

  it('lists no provider when none is configured, and 404s the routes', async () => {
    google.configured = false;
    facebook.configured = false;
    const list = await http().get(`${API}/auth/social/providers`).expect(200);
    expect(list.body.providers).toEqual([]);
    await http().get(`${API}/auth/social/google/start?intent=login`).expect(404);
    facebook.configured = true;
  });

  it('lists configured providers', async () => {
    const list = await http().get(`${API}/auth/social/providers`).expect(200);
    expect(list.body.providers).toEqual(['google', 'facebook']);
  });

  it('login with a subject that is not connected goes to not_linked and sets no session', async () => {
    google.nextSubject = `${SUB_PREFIX}unknown`;
    const res = await callback(await startLogin());
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?social=not_linked');
    expect(res.headers['set-cookie']?.join(';') ?? '').not.toContain('refresh_token');
  });

  it('connects on purpose, then login with that identity signs the user in', async () => {
    const token = await adminToken();
    expect(await connect(`${SUB_PREFIX}admin`, token)).toContain('/security?linked=google');

    google.nextSubject = `${SUB_PREFIX}admin`;
    const res = await callback(await startLogin());
    expect(res.headers.location).toContain('/auth/social/done');
    expect(res.headers['set-cookie'].join(';')).toContain('refresh_token');

    const identities = await http()
      .get(`${API}/auth/social/identities`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(identities.body).toHaveLength(1);
    expect(identities.body[0].provider).toBe('google');
  });

  it('never connects by matching email: same email, unknown subject stays unlinked', async () => {
    // The provider vouches for the admin's own address, but the subject is new.
    google.nextEmail = SEED_ADMIN_EMAIL;
    google.nextSubject = `${SUB_PREFIX}same-email`;
    const res = await callback(await startLogin());
    expect(res.headers.location).toContain('not_linked');
    const rows = await dataSource.query(`SELECT 1 FROM user_identities WHERE subject = $1`, [
      `${SUB_PREFIX}same-email`,
    ]);
    expect(rows).toHaveLength(0);
    google.nextEmail = 'person@example.com';
  });

  it('link conflict: a subject already connected to another user', async () => {
    const token = await adminToken();
    expect(await connect(`${SUB_PREFIX}shared`, token)).toContain('linked=google');
    await dataSource.query(
      `INSERT INTO users (id, full_name, status) VALUES ($1, 'No Login', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [NOLOGIN_ID],
    );
    const other = await app
      .get(AuthService)
      .startSession(
        (await dataSource.getRepository('User').findOneByOrFail({ id: NOLOGIN_ID })) as never,
        { ip: null, userAgent: null },
      );
    expect(await connect(`${SUB_PREFIX}shared`, other.access_token)).toContain(
      '/security?social=conflict',
    );
  });

  it('register intent sets the ticket cookie and keeps the ticket id out of the URL', async () => {
    google.nextSubject = `${SUB_PREFIX}new`;
    const res = await callback(await startLogin('google', 'register'));
    expect(res.headers.location).toContain('/register?social=google');
    expect(res.headers.location).not.toContain('ticket');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('social_ticket='),
    ) as string;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api/v1/auth');
    const ticketId = cookie.split(';')[0].split('=')[1];
    const ticket = await app.get(SocialTicketService).consume(ticketId);
    expect(ticket?.subject).toBe(`${SUB_PREFIX}new`);
    expect(await app.get(SocialTicketService).consume(ticketId)).toBeNull(); // read-once
  });

  it('a replayed state is refused: back to login, no session', async () => {
    const state = await startLogin();
    await callback(state).expect(302);
    const res = await callback(state);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login?social=failed');
    expect(res.headers['set-cookie']?.join(';') ?? '').not.toContain('refresh_token');
  });

  it('a state started for another provider is refused', async () => {
    const state = await startLogin('facebook');
    const res = await callback(state, 'google');
    expect(res.headers.location).toContain('social=failed');
  });

  it('a state without the matching browser cookie is refused', async () => {
    const state = await startLogin();
    const res = await callback(state, 'google', null);
    expect(res.headers.location).toContain('social=failed');
  });

  it('a provider error redirects with social=cancelled', async () => {
    const state = await startLogin();
    const res = await http()
      .get(`${API}/auth/social/google/callback?error=access_denied&state=${state}`)
      .set('Cookie', [`social_state=${state}`]);
    expect(res.headers.location).toContain('/login?social=cancelled');
  });

  it('start with intent=link is a 400; link-start without a bearer is a 401', async () => {
    await http().get(`${API}/auth/social/google/start?intent=link`).expect(400);
    await http().post(`${API}/auth/social/google/link-start`).expect(401);
  });

  it('an inactive user with a connected identity gets not_linked and no session', async () => {
    await dataSource.query(
      `INSERT INTO users (id, full_name, status) VALUES ($1, 'No Login', 'INACTIVE')
       ON CONFLICT (id) DO UPDATE SET status = 'INACTIVE'`,
      [NOLOGIN_ID],
    );
    await dataSource.query(
      `INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`,
      [NOLOGIN_ID, `${SUB_PREFIX}inactive`],
    );
    google.nextSubject = `${SUB_PREFIX}inactive`;
    const res = await callback(await startLogin());
    expect(res.headers.location).toContain('/login?social=not_linked');
    expect(res.headers['set-cookie']?.join(';') ?? '').not.toContain('refresh_token');
    await dataSource.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [NOLOGIN_ID]);
  });

  it('can still disconnect after the provider is no longer configured', async () => {
    const token = await adminToken();
    await connect(`${SUB_PREFIX}gone`, token);
    google.configured = false;
    await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  it('refuses to remove the last sign-in method, allows it when a password remains', async () => {
    // A user with no password, email or phone: the identity is their only way in.
    await dataSource.query(
      `INSERT INTO users (id, full_name, status) VALUES ($1, 'No Login', 'ACTIVE')
       ON CONFLICT (id) DO NOTHING`,
      [NOLOGIN_ID],
    );
    await dataSource.query(
      `INSERT INTO user_identities (user_id, provider, subject) VALUES ($1, 'google', $2)`,
      [NOLOGIN_ID, `${SUB_PREFIX}only`],
    );
    const lone = await app
      .get(AuthService)
      .startSession(
        (await dataSource.getRepository('User').findOneByOrFail({ id: NOLOGIN_ID })) as never,
        { ip: null, userAgent: null },
      );
    const refused = await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${lone.access_token}`)
      .expect(409);
    expect(refused.body.details.code).toBe('LAST_SIGN_IN_METHOD');

    const token = await adminToken();
    await connect(`${SUB_PREFIX}removable`, token);
    await http()
      .delete(`${API}/auth/social/identities/google`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });
});
