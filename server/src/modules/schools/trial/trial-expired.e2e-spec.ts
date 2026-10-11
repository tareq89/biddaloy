import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test } from '@nestjs/testing';
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
import { TenantStatusService } from '../tenant-status.service';

/**
 * [13.2.3] A request into a school whose trial ended is refused by the real
 * cache -> DB -> ContextGuard path, and says why.
 */
describe('Trial-expired school (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let status: TenantStatusService;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);
    status = app.get(TenantStatusService);
  }, 60000);

  afterAll(async () => {
    await ds.query(`UPDATE schools SET status = 'ACTIVE', status_reason = NULL WHERE id = $1`, [
      SEED_TENANT_ID,
    ]);
    await status.invalidate(SEED_TENANT_ID);
    await app.close();
  });

  it('403s with TENANT_SUSPENDED and reason TRIAL_EXPIRED, and works again once reactivated', async () => {
    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: 'password123' })
      .expect(200);
    const token = login.body.access_token;
    const get = () =>
      supertest(app.getHttpServer())
        .get('/api/v1/students')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', SEED_TENANT_ID);

    await get().expect(200); // also warms the status cache with ACTIVE

    await ds.query(
      `UPDATE schools SET status = 'SUSPENDED', status_reason = 'TRIAL_EXPIRED' WHERE id = $1`,
      [SEED_TENANT_ID],
    );
    await status.invalidate(SEED_TENANT_ID);

    const res = await get().expect(403);
    expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    expect(res.body.details ?? res.body.error?.details ?? res.body.message?.details).toMatchObject({
      code: 'TENANT_SUSPENDED',
      reason: 'TRIAL_EXPIRED',
    });

    await ds.query(`UPDATE schools SET status = 'ACTIVE', status_reason = NULL WHERE id = $1`, [
      SEED_TENANT_ID,
    ]);
    await status.invalidate(SEED_TENANT_ID);
    await get().expect(200);
  });
  // D16 (#2266): an ended trial may still export; nothing else opens.
  describe('workbook export while the trial is expired', () => {
    const TEACHER_ID = '00000000-0000-4000-8000-0000007e0001';
    const OTHER_TENANT = '00000000-0000-4000-8000-0000007e0002';
    const OTHER_ADMIN_ID = '00000000-0000-4000-8000-0000007e0003';
    let adminToken: string;
    let teacherToken: string;
    let otherAdminToken: string;

    const login = async (email: string) =>
      (
        await supertest(app.getHttpServer())
          .post('/api/v1/auth/login')
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token as string;
    const call = (
      method: 'get' | 'post' | 'patch',
      path: string,
      token: string,
      tenant: string,
      role: string,
    ) =>
      supertest(app.getHttpServer())
        [method](`/api/v1${path}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', tenant)
        .set('X-Role', role);
    const setSchool = async (id: string, st: string, reason: string | null) => {
      await ds.query(`UPDATE schools SET status = $2, status_reason = $3 WHERE id = $1`, [
        id,
        st,
        reason,
      ]);
      await status.invalidate(id);
    };
    const addUser = async (id: string, email: string, tenant: string, role: string) => {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Trial E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, tenant, role],
      );
    };

    beforeAll(async () => {
      await ds.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ($1, 'Trial E2E Other', 'trial-e2e-other', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [OTHER_TENANT],
      );
      await addUser(TEACHER_ID, 'trial-e2e-teacher@e2e.example', SEED_TENANT_ID, 'TEACHER');
      await addUser(OTHER_ADMIN_ID, 'trial-e2e-other-admin@e2e.example', OTHER_TENANT, 'ADMIN');
      adminToken = await login(SEED_ADMIN_EMAIL);
      teacherToken = await login('trial-e2e-teacher@e2e.example');
      otherAdminToken = await login('trial-e2e-other-admin@e2e.example');
    }, 60000);

    afterAll(async () => {
      await setSchool(OTHER_TENANT, 'ACTIVE', null);
    });

    it('lets the ADMIN export, poll and download; every other route stays 403', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'TRIAL_EXPIRED');
      const asAdmin = (m: 'get' | 'post' | 'patch', path: string) =>
        call(m, path, adminToken, SEED_TENANT_ID, 'ADMIN');

      const started = await asAdmin('post', '/backup/export').expect(202);
      const jobId = started.body.job_id as string;
      await asAdmin('get', `/backup/jobs/${jobId}`).expect(200);
      // Download is open too: the job may not be DONE yet, but it must not be the suspension 403.
      const dl = await asAdmin('get', `/backup/jobs/${jobId}/download`);
      expect(JSON.stringify(dl.body)).not.toContain('TENANT_SUSPENDED');
    });

    // Each of these stays refused while the trial is expired (not marked @AllowWhenTrialExpired).
    it('still refuses GET /students with TENANT_SUSPENDED', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'TRIAL_EXPIRED');
      const res = await call('get', '/students', adminToken, SEED_TENANT_ID, 'ADMIN').expect(403);
      expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    });

    it('still refuses GET /backup/jobs (list) with TENANT_SUSPENDED', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'TRIAL_EXPIRED');
      const res = await call('get', '/backup/jobs', adminToken, SEED_TENANT_ID, 'ADMIN').expect(
        403,
      );
      expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    });

    it('still refuses PATCH /backup/jobs/:id/pin with TENANT_SUSPENDED', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'TRIAL_EXPIRED');
      const res = await call(
        'patch',
        '/backup/jobs/00000000-0000-4000-8000-0000007e00aa/pin',
        adminToken,
        SEED_TENANT_ID,
        'ADMIN',
      ).expect(403);
      expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    });

    it('still refuses POST /backup/validate with TENANT_SUSPENDED', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'TRIAL_EXPIRED');
      const res = await call(
        'post',
        '/backup/validate',
        adminToken,
        SEED_TENANT_ID,
        'ADMIN',
      ).expect(403);
      expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    });

    it('still refuses POST /backup/restore with TENANT_SUSPENDED', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'TRIAL_EXPIRED');
      const res = await call('post', '/backup/restore', adminToken, SEED_TENANT_ID, 'ADMIN').expect(
        403,
      );
      expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    });

    it('refuses the export when the school is suspended with no TRIAL_EXPIRED reason', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', null);
      const res = await call('post', '/backup/export', adminToken, SEED_TENANT_ID, 'ADMIN').expect(
        403,
      );
      expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    });

    it('refuses the export when the school is suspended for another reason', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'NON_PAYMENT');
      const res = await call('post', '/backup/export', adminToken, SEED_TENANT_ID, 'ADMIN').expect(
        403,
      );
      expect(JSON.stringify(res.body)).toContain('TENANT_SUSPENDED');
    });

    it('still needs BACKUP_MANAGE: a TEACHER gets 403 even on an expired trial', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'TRIAL_EXPIRED');
      const res = await call(
        'post',
        '/backup/export',
        teacherToken,
        SEED_TENANT_ID,
        'TEACHER',
      ).expect(403);
      // Got past the suspension check; refused by the permission check instead.
      expect(JSON.stringify(res.body)).not.toContain('TENANT_SUSPENDED');
    });

    it('does not leak across schools: A expired does not open a suspended B, and an active B is unaffected', async () => {
      await setSchool(SEED_TENANT_ID, 'SUSPENDED', 'TRIAL_EXPIRED');
      await setSchool(OTHER_TENANT, 'SUSPENDED', null);
      const blocked = await call(
        'post',
        '/backup/export',
        otherAdminToken,
        OTHER_TENANT,
        'ADMIN',
      ).expect(403);
      expect(JSON.stringify(blocked.body)).toContain('TENANT_SUSPENDED');

      await setSchool(OTHER_TENANT, 'ACTIVE', null);
      await call('post', '/backup/export', otherAdminToken, OTHER_TENANT, 'ADMIN').expect(202);
    });
  });
});
