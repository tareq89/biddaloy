import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserRole, WIDGET_CATALOGUE } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/** [8.10.7.2.05] D46 matrix for `GET /dashboard/widgets/syllabus-progress`. */
const URL = '/api/v1/dashboard/widgets/syllabus-progress';
const ALLOWED = [UserRole.ADMIN, UserRole.EXECUTIVE];
const DENIED = [
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

describe('[8.10.7.2.05] GET /dashboard/widgets/syllabus-progress', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (role: UserRole, tenantId = SEED_TENANT_ID) =>
    http().get(URL).set('Authorization', `Bearer ${tokens[role]}`).set('X-Tenant-ID', tenantId);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);

    for (const [i, role] of [...ALLOWED, ...DENIED].entries()) {
      const id = `00000000-0000-4000-8000-00000185100${i}`;
      const email = `dash-syllabus-${role.toLowerCase()}@e2e.example`;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH, `Dash ${role}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      tokens[role] = res.body.access_token;
    }
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('catalogue roles are exactly ADMIN and EXECUTIVE', () => {
    expect([...WIDGET_CATALOGUE['syllabus-progress'].roles].sort()).toEqual([...ALLOWED].sort());
  });

  it.each(ALLOWED)('%s gets 200 with the widget shape and the plan fields', async (role) => {
    const res = await get(role);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.classes)).toBe(true);
    expect(res.body.overall).toEqual(
      expect.objectContaining({
        done: expect.any(Number),
        total: expect.any(Number),
        percentage: expect.any(Number),
      }),
    );
    // [8.10.7.7.04] Plan fields are always present: null / 0 when no class has a plan.
    expect(res.body.behind_count).toEqual(expect.any(Number));
    for (const c of res.body.classes) {
      expect(c.expected_percentage === null || typeof c.expected_percentage === 'number').toBe(
        true,
      );
    }
  });

  it.each(DENIED)('%s gets 403', async (role) => {
    expect((await get(role)).status).toBe(403);
  });

  it('a tenant the caller is not a member of is refused (401/403)', async () => {
    const res = await get(UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
  });
});

/** [8.10.7.7.04] D46 matrix for `GET /dashboard/widgets/syllabus-vs-plan`. */
describe('[8.10.7.7.04] GET /dashboard/widgets/syllabus-vs-plan', () => {
  const URL_VS = '/api/v1/dashboard/widgets/syllabus-vs-plan';
  // Catalogue roles (ADMIN, EXECUTIVE); the ticket text says ADMIN only, the catalogue row wins.
  const ALLOWED_VS = [UserRole.ADMIN, UserRole.EXECUTIVE];
  const DENIED_VS = DENIED;
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = http().get(URL_VS).set('Authorization', `Bearer ${tokens[role]}`);
    return tenantId ? req.set('X-Tenant-ID', tenantId) : req;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);
    for (const [i, role] of [...ALLOWED_VS, ...DENIED_VS].entries()) {
      const id = `00000000-0000-4000-8000-00000193000${i}`;
      const email = `dash-vsplan-${role.toLowerCase()}@e2e.example`;
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH, `Dash ${role}`],
      );
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200);
      tokens[role] = res.body.access_token;
    }
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('catalogue roles match the matrix', () => {
    expect([...WIDGET_CATALOGUE['syllabus-vs-plan'].roles].sort()).toEqual([...ALLOWED_VS].sort());
  });

  it('ADMIN gets 200 with the documented shape', async () => {
    const res = await get(UserRole.ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      as_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      behind_count: expect.any(Number),
      not_updated_count: expect.any(Number),
      classes: expect.any(Array),
    });
  });

  it('EXECUTIVE gets 200', async () => {
    expect((await get(UserRole.EXECUTIVE)).status).toBe(200);
  });

  it('ACCOUNTANT gets 403', async () => {
    expect((await get(UserRole.ACCOUNTANT)).status).toBe(403);
  });
  it('TEACHER gets 403', async () => {
    expect((await get(UserRole.TEACHER)).status).toBe(403);
  });
  it('OFFICE_STAFF gets 403', async () => {
    expect((await get(UserRole.OFFICE_STAFF)).status).toBe(403);
  });
  it('EXAM_CONTROLLER gets 403', async () => {
    expect((await get(UserRole.EXAM_CONTROLLER)).status).toBe(403);
  });
  it('COMMITTEE gets 403', async () => {
    expect((await get(UserRole.COMMITTEE)).status).toBe(403);
  });
  it('PARENT gets 403', async () => {
    expect((await get(UserRole.PARENT)).status).toBe(403);
  });
  it('STUDENT gets 403', async () => {
    expect((await get(UserRole.STUDENT)).status).toBe(403);
  });

  it('a missing X-Tenant-ID is refused', async () => {
    expect([400, 401, 403]).toContain((await get(UserRole.ADMIN, null)).status);
  });

  it('an invalid X-Tenant-ID is refused', async () => {
    expect([400, 401, 403]).toContain((await get(UserRole.ADMIN, 'not-a-uuid')).status);
  });

  it('a tenant the caller is not a member of is refused (cross-tenant)', async () => {
    const res = await get(UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
  });
});
