import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { mintCockpitToken, removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_TENANT_ID } from '@test/constants';

/**
 * [4101] `POST /platform/schools/:id/restore`. A platform owner (cockpit token, no school
 * header) reaches a school's restore; a school admin and a bad id are refused.
 */
const API = '/api/v1';

describe('POST /platform/schools/:id/restore E2E (4101)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;
  let adminToken: string;
  const body = { staging_id: randomUUID(), confirmation: 'whatever' };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    ownerToken = await mintCockpitToken(app, ds);
    adminToken = (
      await supertest(app.getHttpServer())
        .post(`${API}/auth/login`)
        .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;
  }, 60000);

  afterAll(async () => {
    await removeCockpitOwners(ds);
    await app.close();
  });

  const post = (id: string, token: string, school = false) => {
    const r = supertest(app.getHttpServer())
      .post(`${API}/platform/schools/${id}/restore`)
      .set('Authorization', `Bearer ${token}`);
    return school ? r.set('X-Tenant-ID', SEED_TENANT_ID).set('X-Role', UserRole.ADMIN) : r;
  };

  it('owner with no school header passes the guards (a missing stage is a 404 from the service)', async () => {
    const res = await post(SEED_TENANT_ID, ownerToken).send(body);
    expect(res.status).toBe(404);
    expect(res.body.code ?? res.body.details?.code).toBe('RESTORE_STAGE_NOT_FOUND');
  });

  it('a school admin is refused, even with their own school header', async () => {
    await post(SEED_TENANT_ID, adminToken, true).send(body).expect(403);
  });

  it('no token is a 401', async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/platform/schools/${SEED_TENANT_ID}/restore`)
      .send(body)
      .expect(401);
  });

  it('a non-UUID id is a 400', async () => {
    await post('not-a-uuid', ownerToken).send(body).expect(400);
  });

  it('an unknown school is a 404', async () => {
    await post(randomUUID(), ownerToken).send(body).expect(404);
  });
});
