import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';
import { UserRole } from '@biddaloy/shared';

/**
 * [14.12.3/#617] E2E for `GET /platform/backups/health`: SUPER_ADMIN only
 * (403 for ADMIN), and the "never backed up" row for a school with no
 * export job.
 */
describe('Platform Backup Health E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let superAdminToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const SUPER_ADMIN_USER_ID = '00000000-0000-4000-8000-0000000c0c01';
  const SUPER_ADMIN_EMAIL = 'superadmin@platform-backup-health-e2e.example';
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

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Platform Backup Health Super Admin', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, SUPER_ADMIN_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SUPER_ADMIN_USER_ID, TENANT_ID, UserRole.SUPER_ADMIN],
    );

    const loginAs = async (email: string) => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token as string;
    };

    adminToken = await loginAs(SEED_ADMIN_EMAIL);
    superAdminToken = await loginAs(SUPER_ADMIN_EMAIL);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects ADMIN with 401 (role guard)', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/platform/backups/health')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(401);
  });

  it('rejects no token with 401', async () => {
    await supertest(app.getHttpServer()).get('/api/v1/platform/backups/health').expect(401);
  });

  it('allows SUPER_ADMIN and returns one row per school, including a "never backed up" row', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/platform/backups/health')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
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
