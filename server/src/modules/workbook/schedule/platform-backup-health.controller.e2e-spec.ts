import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { mintCockpitToken, removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * [14.12.3/#617] E2E for `GET /platform/backups/health`: platform owners only (a cockpit token,
 * Epic 98 wave 5; 403 for a school ADMIN, 401 without a token), and the "never backed up" row
 * for a school with no export job.
 */
describe('Platform Backup Health E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let ownerToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const NEVER_BACKED_UP_TENANT_ID = '00000000-0000-4000-8000-0000000c0c02';

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set to run e2e tests');
    }
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // A second school that has never run a backup — the "never" row.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Never Backed Up School', 'never-backed-up-e2e', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [NEVER_BACKED_UP_TENANT_ID],
    );

    const res = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = res.body.access_token as string;
    ownerToken = await mintCockpitToken(app, dataSource);
  });

  afterAll(async () => {
    await removeCockpitOwners(dataSource);
    await app.close();
  });

  it('rejects a school ADMIN with 403', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/platform/backups/health')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(403);
  });

  it('rejects no token with 401', async () => {
    await supertest(app.getHttpServer()).get('/api/v1/platform/backups/health').expect(401);
  });

  it('allows a platform owner and returns one row per school, including a "never backed up" row', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/platform/backups/health')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    const neverRow = res.body.data.find(
      (row: { school_id: string }) => row.school_id === NEVER_BACKED_UP_TENANT_ID,
    );
    expect(neverRow).toBeDefined();
    expect(neverRow.last_status).toBeNull();
    expect(neverRow.last_success_at).toBeNull();
    expect(neverRow.storage_total_bytes).toBe('0');
    // `DEFAULT_BACKUP_SETTINGS.schedule` (`tenant-settings-defaults.ts`) is
    // `WEEKLY`, not `OFF` — a school that never touched this setting still
    // resolves to the platform default, same as `getResolvedSettings`
    // returns for every other unset section.
    expect(neverRow.schedule).toBe('WEEKLY');
  });
});
