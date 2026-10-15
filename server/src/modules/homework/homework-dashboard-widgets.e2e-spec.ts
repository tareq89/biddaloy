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

/**
 * [8.10.7.3.04] `homework-to-check` and [8.10.7.3.19] `homework-submission-rate` /
 * `my-syllabus-progress`: D46 role matrix, one explicit `it` per role per route.
 */
const BASE = '/api/v1/dashboard/widgets';
const ALL_ROLES = [
  UserRole.ADMIN,
  UserRole.EXECUTIVE,
  UserRole.ACCOUNTANT,
  UserRole.TEACHER,
  UserRole.OFFICE_STAFF,
  UserRole.EXAM_CONTROLLER,
  UserRole.COMMITTEE,
  UserRole.PARENT,
  UserRole.STUDENT,
];

describe('[8.10.7.3.04/19] homework dashboard widget routes', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (route: string, role: UserRole, tenantId = SEED_TENANT_ID) =>
    http()
      .get(`${BASE}/${route}`)
      .set('Authorization', `Bearer ${tokens[role]}`)
      .set('X-Tenant-ID', tenantId);
  const keys = (body: object) => Object.keys(body).sort();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    const dataSource = app.get(DataSource);

    for (const [i, role] of ALL_ROLES.entries()) {
      const id = `00000000-0000-4000-8000-00000186400${i}`;
      const email = `dash-hw-widgets-${role.toLowerCase()}@e2e.example`;
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

  it('catalogue roles are exactly what the routes allow', () => {
    expect(WIDGET_CATALOGUE['homework-to-check'].roles).toEqual([UserRole.TEACHER]);
    expect(WIDGET_CATALOGUE['homework-submission-rate'].roles).toEqual([UserRole.ADMIN]);
    expect(WIDGET_CATALOGUE['my-syllabus-progress'].roles).toEqual([UserRole.TEACHER]);
  });

  describe('GET homework-to-check (TEACHER only)', () => {
    const route = 'homework-to-check';

    it('TEACHER gets 200 and the DTO keys', async () => {
      const res = await get(route, UserRole.TEACHER);
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual(['assignment_count', 'items', 'total_submitted']);
    });
    it('ADMIN gets 403', async () => {
      expect((await get(route, UserRole.ADMIN)).status).toBe(403);
    });
    it('EXECUTIVE gets 403', async () => {
      expect((await get(route, UserRole.EXECUTIVE)).status).toBe(403);
    });
    it('ACCOUNTANT gets 403', async () => {
      expect((await get(route, UserRole.ACCOUNTANT)).status).toBe(403);
    });
    it('OFFICE_STAFF gets 403', async () => {
      expect((await get(route, UserRole.OFFICE_STAFF)).status).toBe(403);
    });
    it('EXAM_CONTROLLER gets 403', async () => {
      expect((await get(route, UserRole.EXAM_CONTROLLER)).status).toBe(403);
    });
    it('COMMITTEE gets 403', async () => {
      expect((await get(route, UserRole.COMMITTEE)).status).toBe(403);
    });
    it('PARENT gets 403', async () => {
      expect((await get(route, UserRole.PARENT)).status).toBe(403);
    });
    it('STUDENT gets 403', async () => {
      expect((await get(route, UserRole.STUDENT)).status).toBe(403);
    });
    it('a tenant the caller is not a member of is refused', async () => {
      const res = await get(route, UserRole.TEACHER, '00000000-0000-4000-8000-0000000000aa');
      expect([401, 403]).toContain(res.status);
    });
    it('a missing X-Tenant-ID is refused', async () => {
      const res = await http()
        .get(`${BASE}/${route}`)
        .set('Authorization', `Bearer ${tokens[UserRole.TEACHER]}`);
      expect([400, 401, 403]).toContain(res.status);
    });
  });

  describe('GET homework-submission-rate (ADMIN only)', () => {
    const route = 'homework-submission-rate';

    it('ADMIN gets 200 and the DTO keys', async () => {
      const res = await get(route, UserRole.ADMIN);
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual(['classes', 'overall', 'window']);
      expect(keys(res.body.overall)).toEqual(['assigned', 'percentage', 'submitted']);
      expect(keys(res.body.window)).toEqual(['from', 'to']);
    });
    it('EXECUTIVE gets 403', async () => {
      expect((await get(route, UserRole.EXECUTIVE)).status).toBe(403);
    });
    it('ACCOUNTANT gets 403', async () => {
      expect((await get(route, UserRole.ACCOUNTANT)).status).toBe(403);
    });
    it('TEACHER gets 403', async () => {
      expect((await get(route, UserRole.TEACHER)).status).toBe(403);
    });
    it('OFFICE_STAFF gets 403', async () => {
      expect((await get(route, UserRole.OFFICE_STAFF)).status).toBe(403);
    });
    it('EXAM_CONTROLLER gets 403', async () => {
      expect((await get(route, UserRole.EXAM_CONTROLLER)).status).toBe(403);
    });
    it('COMMITTEE gets 403', async () => {
      expect((await get(route, UserRole.COMMITTEE)).status).toBe(403);
    });
    it('PARENT gets 403', async () => {
      expect((await get(route, UserRole.PARENT)).status).toBe(403);
    });
    it('STUDENT gets 403', async () => {
      expect((await get(route, UserRole.STUDENT)).status).toBe(403);
    });
    it('a tenant the caller is not a member of is refused', async () => {
      const res = await get(route, UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
      expect([401, 403]).toContain(res.status);
    });
  });

  describe('GET my-syllabus-progress (TEACHER only)', () => {
    const route = 'my-syllabus-progress';

    it('TEACHER gets 200 and the DTO keys', async () => {
      const res = await get(route, UserRole.TEACHER);
      expect(res.status).toBe(200);
      expect(keys(res.body)).toEqual(['behind_count', 'items']);
      expect(res.body.items).toEqual([]);
    });
    it('ADMIN gets 403', async () => {
      expect((await get(route, UserRole.ADMIN)).status).toBe(403);
    });
    it('EXECUTIVE gets 403', async () => {
      expect((await get(route, UserRole.EXECUTIVE)).status).toBe(403);
    });
    it('ACCOUNTANT gets 403', async () => {
      expect((await get(route, UserRole.ACCOUNTANT)).status).toBe(403);
    });
    it('OFFICE_STAFF gets 403', async () => {
      expect((await get(route, UserRole.OFFICE_STAFF)).status).toBe(403);
    });
    it('EXAM_CONTROLLER gets 403', async () => {
      expect((await get(route, UserRole.EXAM_CONTROLLER)).status).toBe(403);
    });
    it('COMMITTEE gets 403', async () => {
      expect((await get(route, UserRole.COMMITTEE)).status).toBe(403);
    });
    it('PARENT gets 403', async () => {
      expect((await get(route, UserRole.PARENT)).status).toBe(403);
    });
    it('STUDENT gets 403', async () => {
      expect((await get(route, UserRole.STUDENT)).status).toBe(403);
    });
    it('a tenant the caller is not a member of is refused', async () => {
      const res = await get(route, UserRole.TEACHER, '00000000-0000-4000-8000-0000000000aa');
      expect([401, 403]).toContain(res.status);
    });
  });
});
