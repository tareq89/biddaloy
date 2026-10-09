import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { HomeworkGradingMode, UserRole } from '@biddaloy/shared';
import { StorageService } from '../storage/storage.service';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
} from '@test/constants';

/** This spec is about the route's auth/ownership behavior (D26), not S3
 * mechanics — `StorageService` is already covered directly by
 * `storage.service.spec.ts` and exercised end-to-end by `logo.e2e-spec.ts`.
 * Overriding it here avoids depending on a real S3 endpoint being
 * reachable from wherever this suite runs. */
class FakeStorageService {
  async put(): Promise<void> {
    return undefined;
  }
}

const API = '/api/v1';

const PARENT_USER_ID = '00000000-0000-4000-8000-0000096b0001';
const STRANGER_USER_ID = '00000000-0000-4000-8000-0000096b0002';
const PARENT_EMAIL = 'submission-parent@e2e.example';
const STRANGER_EMAIL = 'submission-stranger@e2e.example';

/**
 * E2E for [22.3.2]'s `POST /homework-assignments/:id/submissions`: a
 * guardian uploading their own linked child's submission, and D26's
 * ownership scoping rejecting a guardian who isn't linked to that child
 * (same 403-on-purpose contract as `FamilyAccessService.assertLinked`).
 */
describe('Homework Submission E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let adminToken: string;
  let parentToken: string;
  let strangerToken: string;
  let studentId: string;
  let assignmentId: string;

  const TENANT_ID = SEED_TENANT_ID;
  const SECTION_ID = SEED_SECTION_1_ID;

  async function login(email: string): Promise<string> {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/biddaloy';
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-do-not-use-in-production';
    process.env.NODE_ENV = 'test';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useClass(FakeStorageService)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);

    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Submission Parent', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, PARENT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Submission Stranger', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [STRANGER_USER_ID, STRANGER_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PARENT_USER_ID, TENANT_ID, UserRole.PARENT],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [STRANGER_USER_ID, TENANT_ID, UserRole.PARENT],
    );

    adminToken = await login(SEED_ADMIN_EMAIL);
    parentToken = await login(PARENT_EMAIL);
    strangerToken = await login(STRANGER_EMAIL);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const studentRes = await dataSource.query(
      `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
       VALUES ($1, 'Submission Student', $2, 1, $3, $4, 'ACTIVE', NOW(), NOW())
       RETURNING id`,
      [randomUUID(), `SUBMISSION-E2E-REG-${randomUUID().slice(0, 8)}`, SECTION_ID, TENANT_ID],
    );
    studentId = studentRes[0].id;

    const guardianRes = await dataSource.query(
      `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                              preferred_communication, is_primary_contact, created_at, updated_at)
       VALUES ('Submission Guardian', 'FATHER', '+8801700000001', $1, $2, $3, 'SMS', true, NOW(), NOW())
       RETURNING id`,
      [`submission-guardian-${randomUUID().slice(0, 8)}@e2e.example`, TENANT_ID, PARENT_USER_ID],
    );
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [studentId, guardianRes[0].id],
    );

    const subjectRes = await dataSource.query(
      `INSERT INTO subjects (id, tenant_id, name_en, code, created_at, updated_at)
       VALUES ($1, $2, 'Submission Subject', $3, NOW(), NOW())
       RETURNING id`,
      [randomUUID(), TENANT_ID, `SUB-E2E-${randomUUID().slice(0, 8)}`],
    );

    const createRes = await supertest(app.getHttpServer())
      .post(`${API}/homework`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .send({
        subject_id: subjectRes[0].id,
        class_id: SEED_CLASS_1_ID,
        title: 'Submission E2E homework',
        grading_mode: HomeworkGradingMode.TICK,
      })
      .expect(201);

    const assignRes = await supertest(app.getHttpServer())
      .post(`${API}/homework/${createRes.body.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .send({ section_id: SECTION_ID, assigned_date: '2026-01-01', due_date: '2999-01-08' })
      .expect(201);
    assignmentId = assignRes.body.id;
  });

  it('a guardian uploads their own linked child submission', async () => {
    const res = await supertest(app.getHttpServer())
      .post(`${API}/homework-assignments/${assignmentId}/submissions`)
      .set('Authorization', `Bearer ${parentToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .field('student_id', studentId)
      .attach('files', Buffer.from('%PDF-1.4 test'), {
        filename: 'answer.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    expect(res.body.status).toBe('SUBMITTED');
    expect(res.body.attachments).toHaveLength(1);
  });

  it("rejects a guardian not linked to this student (another guardian's child)", async () => {
    await supertest(app.getHttpServer())
      .post(`${API}/homework-assignments/${assignmentId}/submissions`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.PARENT)
      .field('student_id', studentId)
      .attach('files', Buffer.from('%PDF-1.4 test'), {
        filename: 'answer.pdf',
        contentType: 'application/pdf',
      })
      // FamilyAccessService.assertLinked throws UnauthorizedException (401)
      // on purpose — same contract every other family route uses.
      .expect(401);
  });
});
