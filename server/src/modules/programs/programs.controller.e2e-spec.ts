import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
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
  SEED_SECTION_1_ID,
} from '@test/constants';

/**
 * E2E for the programs routes: CRUD, milestones, reorder, the D23 delete
 * rules, the permission matrix (TEACHER can GET but not write, ACCOUNTANT
 * gets 403 even on GET), UUID param validation, and tenant isolation.
 * `programs`/`program_milestones` etc. are transactional tables — no
 * reseed needed in `beforeEach` beyond the token.
 */
describe('Programs E2E', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminToken: string;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT_ID = randomUUID();

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

    // A second tenant + admin membership, purely to prove tenant isolation.
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Other School', $2, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [OTHER_TENANT_ID, `other-school-${OTHER_TENANT_ID.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, OTHER_TENANT_ID, UserRole.ADMIN],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.TEACHER],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT DO NOTHING`,
      [SEED_ADMIN_USER_ID, TENANT_ID, UserRole.ACCOUNTANT],
    );
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.access_token;
  });

  function req(method: 'get' | 'post' | 'patch' | 'delete' | 'put', path: string, role: UserRole) {
    return supertest(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', role);
  }

  async function createProgram(name = `E2E Program ${randomUUID().slice(0, 8)}`) {
    const res = await req('post', '/api/v1/programs', UserRole.ADMIN).send({ name }).expect(201);
    return res.body.id as string;
  }

  describe('permission matrix', () => {
    it('TEACHER can GET but not POST/DELETE', async () => {
      await req('get', '/api/v1/programs', UserRole.TEACHER).expect(200);
      await req('post', '/api/v1/programs', UserRole.TEACHER)
        .send({ name: 'Should be refused' })
        .expect(401);
    });

    it('ACCOUNTANT is refused even on GET', async () => {
      await req('get', '/api/v1/programs', UserRole.ACCOUNTANT).expect(401);
    });
  });

  describe('UUID param validation', () => {
    it('rejects a non-UUID :id', async () => {
      await req('get', '/api/v1/programs/not-a-uuid', UserRole.ADMIN).expect(400);
    });

    it('rejects a non-UUID :milestoneId', async () => {
      const programId = await createProgram();
      await req('patch', `/api/v1/programs/${programId}/milestones/not-a-uuid`, UserRole.ADMIN)
        .send({ name: 'x' })
        .expect(400);
    });
  });

  describe('CRUD + milestones', () => {
    it('creates, reads, updates, archives a program', async () => {
      const programId = await createProgram();

      const getRes = await req('get', `/api/v1/programs/${programId}`, UserRole.ADMIN).expect(200);
      expect(getRes.body.is_active).toBe(true);
      expect(getRes.body.milestones).toEqual([]);

      const patchRes = await req('patch', `/api/v1/programs/${programId}`, UserRole.ADMIN)
        .send({ is_active: false })
        .expect(200);
      expect(patchRes.body.is_active).toBe(false);
    });

    it('honors ?include_archived=true/false as real query-string booleans', async () => {
      const programId = await createProgram();
      await req('patch', `/api/v1/programs/${programId}`, UserRole.ADMIN)
        .send({ is_active: false })
        .expect(200);

      const hidden = await req(
        'get',
        '/api/v1/programs?include_archived=false',
        UserRole.ADMIN,
      ).expect(200);
      expect(hidden.body.find((p: { id: string }) => p.id === programId)).toBeUndefined();

      const shown = await req(
        'get',
        '/api/v1/programs?include_archived=true',
        UserRole.ADMIN,
      ).expect(200);
      expect(shown.body.find((p: { id: string }) => p.id === programId)).toBeDefined();
    });

    it('appends milestones and reorders them', async () => {
      const programId = await createProgram();

      const m1 = await req('post', `/api/v1/programs/${programId}/milestones`, UserRole.ADMIN)
        .send({ name: 'Juz 1' })
        .expect(201);
      const m2 = await req('post', `/api/v1/programs/${programId}/milestones`, UserRole.ADMIN)
        .send({ name: 'Juz 2' })
        .expect(201);
      expect(m1.body.sequence).toBe(1);
      expect(m2.body.sequence).toBe(2);

      const reorderRes = await req(
        'put',
        `/api/v1/programs/${programId}/milestones/order`,
        UserRole.ADMIN,
      )
        .send({ milestone_ids: [m2.body.id, m1.body.id] })
        .expect(200);
      expect(reorderRes.body.map((m: { id: string }) => m.id)).toEqual([m2.body.id, m1.body.id]);
    });

    it('rejects a reorder with a wrong id set', async () => {
      const programId = await createProgram();
      await req('post', `/api/v1/programs/${programId}/milestones`, UserRole.ADMIN)
        .send({ name: 'Juz 1' })
        .expect(201);

      await req('put', `/api/v1/programs/${programId}/milestones/order`, UserRole.ADMIN)
        .send({ milestone_ids: [randomUUID()] })
        .expect(409);
    });

    it('rejects a reorder with a duplicate id in the payload', async () => {
      const programId = await createProgram();
      const m1 = await req('post', `/api/v1/programs/${programId}/milestones`, UserRole.ADMIN)
        .send({ name: 'Juz 1' })
        .expect(201);

      await req('put', `/api/v1/programs/${programId}/milestones/order`, UserRole.ADMIN)
        .send({ milestone_ids: [m1.body.id, m1.body.id] })
        .expect(400);
    });

    it('deletes a milestone and reports achievements_removed', async () => {
      const programId = await createProgram();
      const created = await req('post', `/api/v1/programs/${programId}/milestones`, UserRole.ADMIN)
        .send({ name: 'Juz 1' })
        .expect(201);

      const deleteRes = await req(
        'delete',
        `/api/v1/programs/${programId}/milestones/${created.body.id}`,
        UserRole.ADMIN,
      ).expect(200);
      expect(deleteRes.body).toEqual({ achievements_removed: 0 });
    });

    it("reports each milestone's achievement_count on GET /programs/:id", async () => {
      const programId = await createProgram();
      const created = await req('post', `/api/v1/programs/${programId}/milestones`, UserRole.ADMIN)
        .send({ name: 'Juz 1' })
        .expect(201);

      const getRes = await req('get', `/api/v1/programs/${programId}`, UserRole.ADMIN).expect(200);
      expect(getRes.body.milestones).toEqual([
        expect.objectContaining({ id: created.body.id, achievement_count: 0 }),
      ]);
    });

    it('refuses a duplicate program name with a 409', async () => {
      const name = `Duplicate ${randomUUID().slice(0, 8)}`;
      await createProgram(name);

      await req('post', '/api/v1/programs', UserRole.ADMIN).send({ name }).expect(409);
    });

    it('refuses renaming a program to a name already used by another program', async () => {
      const takenName = `Taken ${randomUUID().slice(0, 8)}`;
      await createProgram(takenName);
      const programId = await createProgram();

      await req('patch', `/api/v1/programs/${programId}`, UserRole.ADMIN)
        .send({ name: takenName })
        .expect(409);
    });
  });

  describe('D23 delete rules', () => {
    it('hard-deletes a program with zero enrolments', async () => {
      const programId = await createProgram();
      await req('delete', `/api/v1/programs/${programId}`, UserRole.ADMIN).expect(200);
      await req('get', `/api/v1/programs/${programId}`, UserRole.ADMIN).expect(404);
    });

    it('refuses delete with a 409 when the program has an enrolment', async () => {
      const programId = await createProgram();

      const studentRes = await dataSource.query(
        `INSERT INTO students (id, full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status, created_at, updated_at)
         VALUES ($1, 'E2E Program Student', $2, 1, $3, $4, 'ACTIVE', NOW(), NOW())
         RETURNING id`,
        [randomUUID(), `E2E-PROG-${randomUUID().slice(0, 8)}`, SEED_SECTION_1_ID, TENANT_ID],
      );
      const studentId = studentRes[0].id;

      await dataSource.query(
        `INSERT INTO program_enrollments (id, tenant_id, program_id, student_id, started_on, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_DATE, 'ACTIVE', NOW(), NOW())`,
        [randomUUID(), TENANT_ID, programId, studentId],
      );

      await req('delete', `/api/v1/programs/${programId}`, UserRole.ADMIN).expect(409);
    });
  });

  describe('tenant isolation', () => {
    it('404s reading a program by id under the wrong tenant', async () => {
      const programId = await createProgram();
      await supertest(app.getHttpServer())
        .get(`/api/v1/programs/${programId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Tenant-ID', OTHER_TENANT_ID)
        .set('X-Role', UserRole.ADMIN)
        .expect(404);
    });
  });
});
