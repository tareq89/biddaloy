import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * [75.9] Tokens are pinned to HS256 + issuer + audience, and JWT_SECRET_PREVIOUS
 * is accepted for verification only (secret rotation).
 */
describe('JWT pinning and rotation E2E', () => {
  const PREVIOUS = 'previous-secret-previous-secret-previous-secret-48';
  const UNRELATED = 'unrelated-secret-unrelated-secret-unrelated-48';
  const API = '/api/v1';
  let app: INestApplication;
  let current: string;
  let claims: Record<string, unknown>;
  let issuerSeen: unknown;
  let audienceSeen: unknown;
  let accessToken: string;
  const rawJwt = new JwtService({});

  const me = (token: string, tenantId: string = SEED_TENANT_ID) =>
    supertest(app.getHttpServer())
      .get(`${API}/users/me`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', tenantId);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:***@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.JWT_SECRET_PREVIOUS = PREVIOUS;
    process.env.NODE_ENV = 'test';
    current = process.env.JWT_SECRET;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    const login = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    accessToken = login.body.access_token;
    // Re-use the real token's claims so forged tokens differ only in what is under test.
    const decoded = rawJwt.decode(accessToken) as Record<string, unknown>;
    const { iat: _iat, exp: _exp, iss: _iss, aud: _aud, ...rest } = decoded;
    claims = rest;
    issuerSeen = decoded.iss;
    audienceSeen = decoded.aud;
  }, 60000);

  afterAll(async () => {
    delete process.env.JWT_SECRET_PREVIOUS;
    await app.close();
  });

  const forge = (secret: string, opts: Record<string, unknown> = {}) =>
    rawJwt.sign(claims, { secret, expiresIn: 600, ...opts });

  it('real login token is signed HS256 with issuer and audience, and works', async () => {
    const header = JSON.parse(Buffer.from(accessToken.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
    expect(issuerSeen).toBe('biddaloy');
    expect(audienceSeen).toBe('biddaloy:access');
    await me(accessToken).expect(200);
  });

  it('accepts an access token signed with JWT_SECRET_PREVIOUS (rotation)', async () => {
    await me(
      forge(PREVIOUS, { algorithm: 'HS256', issuer: 'biddaloy', audience: 'biddaloy:access' }),
    ).expect(200);
  });

  it('rejects an HS512 token', async () => {
    // Failing-first repro: before the pin, any algorithm the secret could sign was accepted.
    await me(
      forge(current, { algorithm: 'HS512', issuer: 'biddaloy', audience: 'biddaloy:access' }),
    ).expect(401);
  });

  it('rejects an alg:none token', async () => {
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      ...claims,
      iss: 'biddaloy',
      aud: 'biddaloy:access',
      exp: Math.floor(Date.now() / 1000) + 600,
    })}.`;
    await me(token).expect(401);
  });

  it('rejects a token with the wrong audience (e.g. an approval token used as Bearer)', async () => {
    await me(forge(current, { issuer: 'biddaloy', audience: 'biddaloy:approval' })).expect(401);
  });

  it('rejects a token with no audience / no issuer', async () => {
    await me(forge(current, { issuer: 'biddaloy' })).expect(401);
    await me(forge(current, { audience: 'biddaloy:access' })).expect(401);
  });

  it('rejects a token with the wrong issuer', async () => {
    await me(forge(current, { issuer: 'someone-else', audience: 'biddaloy:access' })).expect(401);
  });

  it('rejects a token signed with an unrelated secret', async () => {
    await me(forge(UNRELATED, { issuer: 'biddaloy', audience: 'biddaloy:access' })).expect(401);
  });

  it('keeps tenant isolation for a rotated-secret token: another tenant id is refused', async () => {
    const token = forge(PREVIOUS, { issuer: 'biddaloy', audience: 'biddaloy:access' });
    const other = '00000000-0000-4000-8000-0000000009ff';
    const normal = await me(accessToken, other);
    const rotated = await me(token, other);
    // Same refusal as a normal token, and never a 200.
    expect(normal.status).not.toBe(200);
    expect(rotated.status).toBe(normal.status);
  });
});
