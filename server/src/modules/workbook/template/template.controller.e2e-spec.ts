import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const FIXTURES_DIR = join(__dirname, '../../../../test/fixtures/workbook');
const HAND_FILLED_XLSX = readFileSync(join(FIXTURES_DIR, 'hand-filled.xlsx'));

/**
 * [14.13.1] E2E tests for GET /backup/template.
 *
 * Focus: permission/role guard both directions, `lang` selection, that the
 * body is a real workbook with every sheet the ticket asks for, and that
 * importing the untouched template back through `POST /backup/validate`
 * produces zero errors and zero creates (samples skipped).
 */
describe('GET /backup/template E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;
  let teacherToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const TEACHER_USER_ID = '00000000-0000-4000-8000-0000000c1301';
  const TEACHER_EMAIL = 'teacher@template-e2e.example';

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

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Template E2E Teacher', 'ACTIVE', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TEACHER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [TEACHER_USER_ID, TENANT_ID, UserRole.TEACHER],
    );

    const loginAs = async (email: string) => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      return res.body.access_token as string;
    };

    adminToken = await loginAs(SEED_ADMIN_EMAIL);
    teacherToken = await loginAs(TEACHER_EMAIL);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('guards', () => {
    it('allows ADMIN', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/backup/template')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID);
      expect(res.status).toBe(200);
    });

    it('rejects TEACHER with 401 (role guard, before permission check)', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/backup/template')
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(401);
    });

    it('rejects no token with 401', async () => {
      await supertest(app.getHttpServer()).get('/api/v1/backup/template').expect(401);
    });

    it('requires X-Tenant-ID', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/backup/template')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(401);
    });
  });

  describe('lang', () => {
    it('defaults to the tenant locale (bn, per seed school settings)', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/backup/template')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
      expect(res.header['content-disposition']).toContain('biddaloy-template-bn.xlsx');
    });

    it('honours an explicit ?lang=en', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/backup/template?lang=en')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);
      expect(res.header['content-disposition']).toContain('biddaloy-template-en.xlsx');
    });

    it('rejects an unsupported lang', async () => {
      await supertest(app.getHttpServer())
        .get('/api/v1/backup/template?lang=fr')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(400);
    });
  });

  describe('response shape', () => {
    // The workbook's own internal shape (every EXPECTED_TABS sheet, _meta
    // then _readme, sample rows, dropdowns, header comments) is asserted in
    // `template.service.spec.ts` via exceljs directly — a plain `.spec.ts`
    // file, which `workbook-codec.spec.ts`'s "exceljs containment" check
    // excludes. This suite only needs to prove the HTTP surface is wired up.
    it('streams a non-empty xlsx with the right content-type', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/backup/template')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .buffer()
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.header['content-type']).toContain(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect((res.body as Buffer).byteLength).toBeGreaterThan(0);
    });
  });

  describe('round-trip through POST /backup/validate', () => {
    it('the untouched template validates with zero errors and zero creates', async () => {
      const templateRes = await supertest(app.getHttpServer())
        .get('/api/v1/backup/template')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .buffer()
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      const validateRes = await supertest(app.getHttpServer())
        .post('/api/v1/backup/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .attach('file', templateRes.body as Buffer, 'template.xlsx')
        .expect(201);

      expect(validateRes.body.errors).toEqual([]);
      expect(validateRes.body.totals.creates).toBe(0);
      expect(validateRes.body.totals.updates).toBe(0);
      // The blank template's non-`school` tabs are all "present, zero rows"
      // (the one SAMPLE row is skipped) — without the TEMPLATE-kind guard
      // in `DiffService`, every `deleteByAbsence` tab (users, invoices,
      // payments, student_fees, ...) would read that as "delete everything
      // that currently exists". This assertion fails before that guard and
      // passes after it.
      expect(validateRes.body.totals.deletes).toBe(0);
    });
  });

  describe('hand-filled.xlsx (see make-fixtures.ts)', () => {
    it('names the lower-cased-enum cell as an error, never a stack, and accepts the Bengali-digit date', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/backup/validate')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .attach('file', HAND_FILLED_XLSX, 'hand-filled.xlsx')
        .expect(201);

      // The one deliberate error: `users` row 2's `role` cell is "admin"
      // instead of "ADMIN". Named precisely, not a generic failure.
      expect(res.body.errors).toHaveLength(1);
      const [error] = res.body.errors;
      expect(error.tab).toBe('users');
      expect(error.row).toBe(2);
      expect(error.column).toBe('role');

      // The `academic_years` sheet's SAMPLE row and its Bengali-digit,
      // stray-spaced real row must not add any error of their own.
      expect(
        (res.body.errors as Array<{ tab: string }>).some((e) => e.tab === 'academic_years'),
      ).toBe(false);
    });
  });
});
