import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_ADMIN_PASSWORD_HASH,
} from '@test/constants';

/** [48.2.07] GET /print-history/queue over HTTP: who may read it, and that tenants never mix. */
const API = '/api/v1';
// DOCUMENT_PRINT holders: the queue is for the people who print (ACCOUNTANT included).
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

describe('Print queue E2E (48.2.07)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const tokens: Record<string, string> = {};
  let otherTenantId: string;
  let otherAdminToken: string;

  const http = () => supertest(app.getHttpServer());
  const as = (role: string, tenant = SEED_TENANT_ID) => ({
    Authorization: `Bearer ${tokens[role]}`,
    'X-Tenant-ID': tenant,
  });
  const one = async (sql: string, p: unknown[]) => (await ds.query(sql, p))[0].id as string;

  async function addUser(role: UserRole, tenantId: string): Promise<string> {
    const id = randomUUID();
    const email = `pq-e2e-${role}-${id}@e2e.example`;
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())`,
      [id, email, SEED_ADMIN_PASSWORD_HASH, `PQ E2E ${role}`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return email;
  }
  async function login(email: string): Promise<string> {
    const res = await http()
      .post(`${API}/auth/login`)
      .send({ email, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    return res.body.access_token;
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

    tokens[UserRole.ADMIN] = await login(SEED_ADMIN_EMAIL);
    for (const role of [...ALLOWED, ...DENIED]) {
      if (role === UserRole.ADMIN) continue;
      tokens[role] = await login(await addUser(role, SEED_TENANT_ID));
    }
    otherTenantId = await one(`INSERT INTO schools (name, slug) VALUES ($1, $2) RETURNING id`, [
      `PQ Other ${randomUUID()}`,
      `pq-other-${randomUUID()}`,
    ]);
    otherAdminToken = await login(await addUser(UserRole.ADMIN, otherTenantId));
  });

  afterAll(async () => {
    await app.close();
  });

  /** `n` ACTIVE students (so n ID cards are waiting) in the other tenant. */
  async function seedOtherStudents(n: number) {
    const year = await one(
      `INSERT INTO academic_years (name, start_date, end_date, tenant_id)
       VALUES ('2026', '2026-01-01', '2026-12-31', $1) RETURNING id`,
      [otherTenantId],
    );
    const cls = await one(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Class 8', $1, $2) RETURNING id`,
      [year, otherTenantId],
    );
    const section = await one(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [cls, otherTenantId],
    );
    for (let roll = 1; roll <= n; roll++) {
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id)
         VALUES ('Other', $1, $2, $3, $4)`,
        [`PQ-${randomUUID()}`, roll, section, otherTenantId],
      );
    }
  }

  it('role matrix', async () => {
    for (const role of ALLOWED) {
      const res = await http().get(`${API}/print-history/queue`).set(as(role)).expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          total: expect.any(Number),
          by_kind: expect.any(Array),
          exams: expect.any(Array),
        }),
      );
    }
    for (const role of DENIED) {
      await http().get(`${API}/print-history/queue`).set(as(role)).expect(403);
    }
  });

  it('is tenant scoped, and needs X-Tenant-ID', async () => {
    const before = await http()
      .get(`${API}/print-history/queue`)
      .set(as(UserRole.ADMIN))
      .expect(200);

    await seedOtherStudents(2);

    // Tenant 2's ADMIN sees tenant 2's two waiting ID cards...
    const other = await http()
      .get(`${API}/print-history/queue`)
      .set({ Authorization: `Bearer ${otherAdminToken}`, 'X-Tenant-ID': otherTenantId })
      .expect(200);
    expect(other.body.by_kind).toEqual([{ kind: 'STUDENT_ID_CARD', count: 2 }]);
    expect(other.body.total).toBe(2);

    // ...and those students never change tenant 1's numbers.
    const after = await http()
      .get(`${API}/print-history/queue`)
      .set(as(UserRole.ADMIN))
      .expect(200);
    expect(after.body).toEqual(before.body);

    // The ID-card list is scoped the same way.
    const idUrl = `${API}/print-history/queue/id-cards`;
    const otherList = await http()
      .get(idUrl)
      .set({ Authorization: `Bearer ${otherAdminToken}`, 'X-Tenant-ID': otherTenantId })
      .expect(200);
    expect(otherList.body.total).toBe(2);
    expect(otherList.body.data[0]).toHaveProperty('has_photo', false);
    const ownList = await http().get(idUrl).set(as(UserRole.ADMIN)).expect(200);
    expect(ownList.body.total).toBe(
      before.body.by_kind.find((k: any) => k.kind === 'STUDENT_ID_CARD')?.count ?? 0,
    );

    await http()
      .get(`${API}/print-history/queue`)
      .set({ Authorization: `Bearer ${tokens[UserRole.ADMIN]}` })
      .expect(401);
  });

  describe('GET /print-history/queue/id-cards', () => {
    const url = `${API}/print-history/queue/id-cards`;

    it('role matrix', async () => {
      for (const role of ALLOWED) {
        const res = await http().get(url).set(as(role)).expect(200);
        expect(res.body).toEqual(
          expect.objectContaining({ data: expect.any(Array), total: expect.any(Number) }),
        );
      }
      for (const role of DENIED) {
        await http().get(url).set(as(role)).expect(403);
      }
    });
  });
});
