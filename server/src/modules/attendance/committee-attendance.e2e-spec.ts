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

/** [8.10.7.4.08] D46 matrix for `GET /dashboard/widgets/committee-attendance`. */
const URL = '/api/v1/dashboard/widgets/committee-attendance';
const ROLES = [
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
const PII_KEYS = [
  'full_name',
  'student_name',
  'guardian_name',
  'name',
  'phone',
  'email',
  'registration_number',
  'roll_number',
  'address',
];

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => [k, ...keysDeep(v)]);
  }
  return [];
}

describe('[8.10.7.4.08] GET /dashboard/widgets/committee-attendance', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};
  const http = () => supertest(app.getHttpServer());
  const get = (role: UserRole, tenantId: string | null = SEED_TENANT_ID) => {
    const req = http().get(URL).set('Authorization', `Bearer ${tokens[role]}`);
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

    for (const [i, role] of ROLES.entries()) {
      const id = `00000000-0000-4000-8000-00000188900${i}`;
      const email = `dash-cmt-att-${role.toLowerCase()}@e2e.example`;
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

  it('catalogue roles are exactly COMMITTEE, ADMIN, EXECUTIVE', () => {
    expect([...WIDGET_CATALOGUE['committee-attendance'].roles].sort()).toEqual(
      [UserRole.COMMITTEE, UserRole.ADMIN, UserRole.EXECUTIVE].sort(),
    );
  });

  it.each([UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.COMMITTEE])(
    '%s gets 200 with the widget shape and no personal data',
    async (role) => {
      const res = await get(role);
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual([
        'current_month_percentage',
        'months',
        'target_percentage',
        'year_percentage',
      ]);
      expect(typeof res.body.target_percentage).toBe('number');
      // No-PII: no id, *_id or identifying field anywhere in the body.
      for (const key of keysDeep(res.body)) {
        expect(key === 'id' || key.endsWith('_id') || PII_KEYS.includes(key)).toBe(false);
      }
    },
  );

  it('ACCOUNTANT gets 403', async () => expect((await get(UserRole.ACCOUNTANT)).status).toBe(403));
  it('TEACHER gets 403', async () => expect((await get(UserRole.TEACHER)).status).toBe(403));
  it('OFFICE_STAFF gets 403', async () =>
    expect((await get(UserRole.OFFICE_STAFF)).status).toBe(403));
  it('EXAM_CONTROLLER gets 403', async () =>
    expect((await get(UserRole.EXAM_CONTROLLER)).status).toBe(403));
  it('PARENT gets 403', async () => expect((await get(UserRole.PARENT)).status).toBe(403));
  it('STUDENT gets 403', async () => expect((await get(UserRole.STUDENT)).status).toBe(403));

  it('a missing X-Tenant-ID is refused', async () => {
    expect([400, 401, 403]).toContain((await get(UserRole.ADMIN, null)).status);
  });

  it('an invalid X-Tenant-ID is refused', async () => {
    expect([400, 401, 403]).toContain((await get(UserRole.ADMIN, 'not-a-uuid')).status);
  });

  it("a school A caller with school B's header never sees B's data", async () => {
    const res = await get(UserRole.ADMIN, '00000000-0000-4000-8000-0000000000aa');
    expect([401, 403]).toContain(res.status);
  });
});
