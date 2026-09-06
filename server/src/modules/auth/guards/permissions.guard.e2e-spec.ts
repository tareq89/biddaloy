import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import {
  Controller,
  Get,
  INestApplication,
  Module,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DataSource } from 'typeorm';
import { Permission, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { ContextGuard, RolesGuard } from './context.guard';
import { PermissionsGuard } from './permissions.guard';
import { Roles } from '../decorators/roles.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

/**
 * HTTP-level proof that the 4-guard stack is actually wired, not just that
 * PermissionsGuard behaves correctly in isolation (permissions.guard.spec.ts
 * covers that). A throwaway probe route, gated on a permission neither
 * TEACHER nor most staff hold, confirms order (ContextGuard before
 * PermissionsGuard), wiring (DI resolves through AuthModule, which is
 * @Global), and the resulting status code end to end.
 */
@Controller('perm-probe')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
class ProbeController {
  @Get()
  @Roles(UserRole.TEACHER, UserRole.ADMIN)
  @RequirePermissions(Permission.USER_CREATE)
  probe() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('PermissionsGuard wiring (regression)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;

  const TENANT_ID = SEED_TENANT_ID;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, ProbeModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    dataSource = app.get(DataSource);

    // Seeded admin already holds ADMIN in this tenant — add TEACHER too, so
    // one login can probe both an admitted-and-permitted role (ADMIN) and an
    // admitted-but-unpermitted one (TEACHER), same pattern as
    // role-resolution.e2e-spec.ts.
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

  it('allows ADMIN, which holds USER_CREATE', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/perm-probe')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(200);
  });

  it('rejects TEACHER, which passes @Roles but lacks USER_CREATE', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/perm-probe')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(403);

    expect(res.body.message).toContain('USER_CREATE');
  });
});
