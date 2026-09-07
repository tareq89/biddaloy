import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * [15.5.3]/[15.5.4] `POST`/`DELETE /schools/me/logo` and
 * `GET /schools/:id/logo`, end-to-end against a real MinIO — proves the
 * whole "validate real bytes, ignore the declared MIME, re-encode, store,
 * clean up the old object, then serve it back tenant-scoped" pipeline
 * actually works over HTTP, not just against mocked `sharp`/
 * `StorageService` calls (see `logo.service.spec.ts` for those).
 */
describe('School logo (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000005a0001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    // Leave no logo behind for other e2e files sharing the seeded tenant.
    await dataSource.query(`UPDATE schools SET logo_key = NULL WHERE id = $1`, [TENANT_ID]);
    await app.close();
  });

  async function realPng(width: number, height: number): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();
  }

  it('accepts a real PNG sent with a text/plain MIME (bytes are trusted, not the declared type)', async () => {
    const png = await realPng(64, 64);

    const res = await supertest(app.getHttpServer())
      .post('/api/v1/schools/me/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .attach('file', png, { filename: 'logo.txt', contentType: 'text/plain' })
      .expect(201);

    expect(res.body.logo_url).toMatch(new RegExp(`^/schools/${TENANT_ID}/logo\\?v=`));
  });

  it('rejects a plain text file even when named "logo.png"', async () => {
    const notAnImage = Buffer.from('this is not an image');

    await supertest(app.getHttpServer())
      .post('/api/v1/schools/me/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .attach('file', notAnImage, { filename: 'logo.png', contentType: 'image/png' })
      .expect(400);
  });

  it('rejects an image wider than 2048px', async () => {
    const huge = await realPng(3000, 100);

    await supertest(app.getHttpServer())
      .post('/api/v1/schools/me/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .attach('file', huge, { filename: 'logo.png', contentType: 'image/png' })
      .expect(400);
  });

  it('rejects a file over the 512KB limit', async () => {
    const oversized = Buffer.alloc(512 * 1024 + 1, 1);

    await supertest(app.getHttpServer())
      .post('/api/v1/schools/me/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .attach('file', oversized, { filename: 'logo.png', contentType: 'image/png' })
      .expect((res) => {
        expect([400, 413]).toContain(res.status);
      });
  });

  it('replaces the logo and removes it on DELETE', async () => {
    const png = await realPng(32, 32);

    const uploadRes = await supertest(app.getHttpServer())
      .post('/api/v1/schools/me/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .attach('file', png, { filename: 'logo.png', contentType: 'image/png' })
      .expect(201);
    expect(uploadRes.body.logo_url).toBeTruthy();

    await supertest(app.getHttpServer())
      .delete('/api/v1/schools/me/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(204);

    const school = await dataSource.query(`SELECT logo_key FROM schools WHERE id = $1`, [
      TENANT_ID,
    ]);
    expect(school[0].logo_key).toBeNull();
  });

  describe('GET /schools/:id/logo', () => {
    it('serves the bytes with immutable caching headers for a member of that school', async () => {
      const png = await realPng(16, 16);
      await supertest(app.getHttpServer())
        .post('/api/v1/schools/me/logo')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .attach('file', png, { filename: 'logo.png', contentType: 'image/png' });

      const res = await supertest(app.getHttpServer())
        .get(`/api/v1/schools/${TENANT_ID}/logo`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    });

    it('rejects a caller whose active tenant is a different school', async () => {
      await supertest(app.getHttpServer())
        .get(`/api/v1/schools/${OTHER_TENANT_ID}/logo`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(403);
    });

    it('404s when the school has no logo', async () => {
      await dataSource.query(`UPDATE schools SET logo_key = NULL WHERE id = $1`, [TENANT_ID]);

      await supertest(app.getHttpServer())
        .get(`/api/v1/schools/${TENANT_ID}/logo`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });
});
