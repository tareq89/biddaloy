import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { DataSource } from 'typeorm';
import { UserRole } from '@beton-boi/shared';
import { SEED_TENANT_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_USER_ID, SEED_ADMIN_PASSWORD } from '@test/constants';

/**
 * End-to-end coverage for #31 item 3 — ContextGuard's role resolution
 * (context.guard.spec.ts already covers this at the unit level; this
 * proves the same behavior through a real HTTP round trip). The seeded
 * admin is given a *second* membership row in the same tenant (schema
 * allows this: the unique index is (user_id, tenant_id, role), not
 * (user_id, tenant_id) — one user can hold several distinct roles in one
 * tenant), then used against GET /audit-logs, which is @Roles(ADMIN)-only
 * and therefore a clean single-role probe.
 */
describe('Role resolution (regression)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // Seeded admin already holds ADMIN (priority 90) in this tenant — add
    // TEACHER (priority 70) too, so both the default (no X-Role) and the
    // explicit-override paths have two real, held roles to choose between.
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ('${SEED_ADMIN_USER_ID}', '${TENANT_ID}', '${UserRole.TEACHER}', NOW(), NOW())
       ON CONFLICT DO NOTHING`,
    );

    const loginRes = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = loginRes.body.access_token;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('defaults to the highest-priority held role when X-Role is omitted', async () => {
    // ADMIN (90) beats TEACHER (70) — GET /audit-logs requires ADMIN.
    await supertest(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .expect(200);
  });

  it('honors an explicit X-Role that lowers the effective role below what RolesGuard requires', async () => {
    // Forcing TEACHER even though ADMIN is also held and would otherwise
    // win by priority — proves X-Role actually takes effect, not just that
    // omitting it happens to pick the right role by luck.
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(401);

    expect(res.body.message).toContain('Requires one of roles');
  });

  it('rejects an explicit X-Role naming a role the user does not hold in that tenant', async () => {
    // The user holds ADMIN and TEACHER here, never STUDENT — this must be
    // a hard rejection, not a silent fallback to a role they do hold.
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.STUDENT)
      .expect(401);

    expect(res.body.message).toContain('not a member');
  });
});
