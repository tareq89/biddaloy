import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { UserRole } from '@biddaloy/shared';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
} from '@test/constants';

/**
 * E2E tests for the Subjects endpoints (`/subjects`,
 * `/classes/:classId/subjects`). Covers every route's allowed and denied
 * role, and missing/wrong `X-Tenant-ID`.
 */
describe('Subjects E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ('${OTHER_TENANT_ID}', 'Other School', 'other-school', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    // The seed admin also holds ADMIN in OTHER_TENANT_ID, purely so this
    // spec can set up an "other tenant's subject" fixture through the
    // same HTTP API rather than inserting rows directly — the token's
    // memberships array (not the X-Tenant-ID header alone) is what
    // ContextGuard checks, so this must be a real membership row.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${OTHER_TENANT_ID}', '${UserRole.ADMIN}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  async function studentToken(): Promise<string> {
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', '${UserRole.STUDENT}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return loginRes.body.access_token;
  }

  async function teacherToken(): Promise<string> {
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${SEED_TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );
    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return loginRes.body.access_token;
  }

  describe('POST /subjects', () => {
    it('creates a subject as ADMIN', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'Mathematics', code: 'MATH' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.code).toBe('MATH');
      expect(res.body.tenant_id).toBe(TENANT_ID);
    });

    it('returns 401 without X-Tenant-ID', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name_en: 'Mathematics', code: 'MATH2' })
        .expect(401);

      expect(res.body.message).toBe('X-Tenant-ID header is required');
    });

    it('returns 401 for a tenant the caller has no membership in', async () => {
      const NO_MEMBERSHIP_TENANT_ID = '00000000-0000-4000-8000-000000000098';
      await dataSource.query(
        `INSERT INTO schools (id, name, slug, created_at, updated_at)
         VALUES ('${NO_MEMBERSHIP_TENANT_ID}', 'No Membership School', 'no-membership-school', NOW(), NOW())
         ON CONFLICT DO NOTHING`,
      );

      const res = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', NO_MEMBERSHIP_TENANT_ID)
        .send({ name_en: 'Mathematics', code: 'MATH2B' })
        .expect(401);

      expect(res.body.message).toContain('not a member');
    });

    it('returns 401 for STUDENT role', async () => {
      const token = await studentToken();
      await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ name_en: 'Mathematics', code: 'MATH3' })
        .expect(401);
    });

    it('returns 400 on missing required fields', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({})
        .expect(400);
    });
  });

  describe('GET /subjects', () => {
    it('lists subjects for TEACHER role', async () => {
      await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'Bangla', code: 'BAN' })
        .expect(201);

      const token = await teacherToken();
      const res = await supertest(app.getHttpServer())
        .get('/api/v1/subjects')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.TEACHER)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  describe('GET /subjects/:id', () => {
    it('returns 404 for a subject that does not belong to the tenant', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID)
        .send({ name_en: 'English', code: 'ENG' })
        .expect(201);

      await supertest(app.getHttpServer())
        .get(`/api/v1/subjects/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });
  });

  describe('PATCH /subjects/:id', () => {
    it('updates a subject as ADMIN', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'Physics', code: 'PHY' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .patch(`/api/v1/subjects/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'Physics (updated)' })
        .expect(200);

      expect(res.body.name_en).toBe('Physics (updated)');
    });

    it('returns 401 for STUDENT role', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'Chemistry', code: 'CHE' })
        .expect(201);

      const token = await studentToken();
      await supertest(app.getHttpServer())
        .patch(`/api/v1/subjects/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ name_en: 'Changed' })
        .expect(401);
    });
  });

  describe('DELETE /subjects/:id', () => {
    it('soft-deletes a subject as ADMIN', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'Geography', code: 'GEO' })
        .expect(201);

      await supertest(app.getHttpServer())
        .delete(`/api/v1/subjects/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      await supertest(app.getHttpServer())
        .get(`/api/v1/subjects/${createRes.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(404);
    });

    it('returns 401 for STUDENT role', async () => {
      const createRes = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'History', code: 'HIS' })
        .expect(201);

      const token = await studentToken();
      await supertest(app.getHttpServer())
        .delete(`/api/v1/subjects/${createRes.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .expect(401);
    });
  });

  describe('class-subject attachment routes', () => {
    it('attaches, lists, and detaches a subject on a class', async () => {
      const subjectRes = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'Art', code: 'ART' })
        .expect(201);

      await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${SEED_CLASS_1_ID}/subjects`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ subject_id: subjectRes.body.id, academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(201);

      const listRes = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${SEED_CLASS_1_ID}/subjects`)
        .query({ academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].subject_id).toBe(subjectRes.body.id);

      await supertest(app.getHttpServer())
        .delete(`/api/v1/classes/${SEED_CLASS_1_ID}/subjects/${subjectRes.body.id}`)
        .query({ academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      const listAfterRes = await supertest(app.getHttpServer())
        .get(`/api/v1/classes/${SEED_CLASS_1_ID}/subjects`)
        .query({ academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .expect(200);

      expect(listAfterRes.body).toHaveLength(0);

      const [detachedRow] = await dataSource.query(
        `SELECT deleted_at FROM class_subjects
         WHERE class_id = $1 AND subject_id = $2 AND academic_year_id = $3`,
        [SEED_CLASS_1_ID, subjectRes.body.id, SEED_ACADEMIC_YEAR_ID],
      );
      expect(detachedRow.deleted_at).not.toBeNull();
    });

    it('returns 401 attaching a subject as STUDENT', async () => {
      const subjectRes = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ name_en: 'Music', code: 'MUS' })
        .expect(201);

      const token = await studentToken();
      await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${SEED_CLASS_1_ID}/subjects`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', UserRole.STUDENT)
        .send({ subject_id: subjectRes.body.id, academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(401);
    });

    it('returns 404 attaching a subject from another tenant', async () => {
      const otherSubjectRes = await supertest(app.getHttpServer())
        .post('/api/v1/subjects')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID)
        .send({ name_en: 'Drama', code: 'DRA' })
        .expect(201);

      await supertest(app.getHttpServer())
        .post(`/api/v1/classes/${SEED_CLASS_1_ID}/subjects`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', TENANT_ID)
        .send({ subject_id: otherSubjectRes.body.id, academic_year_id: SEED_ACADEMIC_YEAR_ID })
        .expect(404);
    });
  });
});
