import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_CLASS_1_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/**
 * [48.2.05] Role matrix and tenant isolation for the two exam-document feeds.
 * Business logic is covered by the integration spec; this proves the guards.
 */
const API = '/api/v1';
const ALLOWED = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.ACCOUNTANT,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
];
const DENIED = [
  UserRole.EXECUTIVE,
  UserRole.TEACHER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

describe('Exam documents E2E (48.2.05)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let examId: string;
  let otherTenantAdminToken: string;
  let otherTenantId: string;
  const tokens = new Map<string, string>();

  const http = () => supertest(app.getHttpServer());
  const asRole = (role: string) => ({
    Authorization: `Bearer ${tokens.get(role)}`,
    'X-Tenant-ID': SEED_TENANT_ID,
  });

  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
  }

  async function addUser(tenantId: string, role: UserRole): Promise<string> {
    const id = randomUUID();
    const email = `exdoc-${role.toLowerCase()}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'ExDoc E2E', 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return email;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    for (const role of [...ALLOWED, ...DENIED]) {
      tokens.set(
        role,
        role === UserRole.ADMIN
          ? await login(SEED_ADMIN_EMAIL)
          : await login(await addUser(SEED_TENANT_ID, role)),
      );
    }

    // A second school with its own ADMIN, to prove tenant 2 cannot read tenant 1's exam.
    const t2 = (
      await ds.query(
        `INSERT INTO schools (name, name_bn, slug) VALUES ($1, 'বিদ্যালয়', $2) RETURNING id`,
        [`ExDoc ${randomUUID()}`, `exdoc-${randomUUID()}`],
      )
    )[0].id;
    const t2Email = await addUser(t2, UserRole.ADMIN);
    const login2 = await http()
      .post(`${API}/auth/login`)
      .send({ email: t2Email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    otherTenantAdminToken = login2.body.access_token;
    otherTenantId = t2;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  // The suite wipes tenant data between tests, so the exam is seeded inside each test.
  async function seedExam() {
    examId = (
      await ds.query(
        `INSERT INTO exams (academic_year_id, class_id, name, kind, status, tenant_id, created_at, updated_at)
         VALUES ($1, $2, 'ExDoc Exam', 'TERM', 'PROCESSED', $3, NOW(), NOW()) RETURNING id`,
        [SEED_ACADEMIC_YEAR_ID, SEED_CLASS_1_ID, SEED_TENANT_ID],
      )
    )[0].id;
  }
  beforeEach(seedExam);

  const routes = (id: string) => [
    `${API}/exams/${id}/documents/admit-cards`,
    `${API}/exams/${id}/documents/merit-candidates`,
  ];

  for (const role of ALLOWED) {
    it(`${role} reads both routes (200)`, async () => {
      for (const url of routes('__EXAM__')) {
        const res = await http().get(url.replace('__EXAM__', examId)).set(asRole(role));
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      }
    });
  }

  for (const role of DENIED) {
    it(`${role} is refused on both routes (403)`, async () => {
      for (const url of routes('__EXAM__')) {
        await http().get(url.replace('__EXAM__', examId)).set(asRole(role)).expect(403);
      }
    });
  }

  it('merit-candidates rejects top=0 and scope=ALL with 400', async () => {
    const url = `${API}/exams/${examId}/documents/merit-candidates`;
    await http().get(`${url}?top=0`).set(asRole('ADMIN')).expect(400);
    await http().get(`${url}?scope=ALL`).set(asRole('ADMIN')).expect(400);
    await http().get(`${url}?top=51`).set(asRole('ADMIN')).expect(400);
  });

  it("tenant 2's ADMIN gets 404 on tenant 1's exam", async () => {
    for (const url of routes(examId)) {
      await http()
        .get(url)
        .set({ Authorization: `Bearer ${otherTenantAdminToken}`, 'X-Tenant-ID': otherTenantId })
        .expect(404);
    }
  });

  it('a missing X-Tenant-ID is 401', async () => {
    for (const url of routes(examId)) {
      await http()
        .get(url)
        .set({ Authorization: `Bearer ${tokens.get('ADMIN')}` })
        .expect(401);
    }
  });
});
