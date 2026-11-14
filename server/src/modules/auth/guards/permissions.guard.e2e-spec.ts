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
import { ModuleKey, Permission, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../../validation-pipe';
import { ContextGuard, RolesGuard } from './context.guard';
import { PermissionsGuard } from './permissions.guard';
import { Roles } from '../decorators/roles.decorator';
import { RequirePermissions } from '../decorators/require-permissions.decorator';
import { AuthenticatedOnly } from '../decorators/authenticated-only.decorator';
import { RequiresModule } from '../decorators/require-module.decorator';
import { MODULE_OFF_MESSAGE } from '../../../common/filters/known-errors';
import { setModules } from '@test/helpers/modules.helper';
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

  // Guards on, no permission, no marker: the fail-closed case.
  @Get('undeclared')
  undeclared() {
    return { ok: true };
  }

  @Get('identity')
  @AuthenticatedOnly()
  identity() {
    return { ok: true };
  }
}

// [Epic 77] A tagged controller: refuses with the fixed sentence while its module is off.
@Controller('module-probe')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
@RequiresModule(ModuleKey.homework)
class ModuleProbeController {
  @Get()
  @RequirePermissions(Permission.FEE_READ)
  probe() {
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController, ModuleProbeController] })
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

  it('[D14] 403s a route that declares neither a permission nor @AuthenticatedOnly, even for ADMIN', async () => {
    const res = await supertest(app.getHttpServer())
      .get('/api/v1/perm-probe/undeclared')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.ADMIN)
      .expect(403);

    expect(res.body.message).toContain('declares no permission');
  });

  it('[D14] lets TEACHER through an @AuthenticatedOnly route', async () => {
    await supertest(app.getHttpServer())
      .get('/api/v1/perm-probe/identity')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', TENANT_ID)
      .set('X-Role', UserRole.TEACHER)
      .expect(200);
  });

  describe('[Epic 77] @RequiresModule', () => {
    const call = (role: UserRole) =>
      supertest(app.getHttpServer())
        .get('/api/v1/module-probe')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', TENANT_ID)
        .set('X-Role', role);

    afterAll(async () => {
      await setModules(app, TENANT_ID, { homework: null });
    });

    it('passes while the module is on', async () => {
      await setModules(app, TENANT_ID, { homework: null });
      await call(UserRole.ADMIN).expect(200);
    });

    it('refuses with the fixed sentence when the school turns it off, then passes again when on', async () => {
      await setModules(app, TENANT_ID, { homework: { on: false } });
      const res = await call(UserRole.ADMIN).expect(403);
      expect(res.body.message).toBe(MODULE_OFF_MESSAGE);
      await setModules(app, TENANT_ID, { homework: { on: true } });
      await call(UserRole.ADMIN).expect(200);
    });

    it('refuses only the role it is off for', async () => {
      await setModules(app, TENANT_ID, { homework: { offForRoles: [UserRole.TEACHER] } });
      const res = await call(UserRole.TEACHER).expect(403);
      expect(res.body.message).toBe(MODULE_OFF_MESSAGE);
      await call(UserRole.ADMIN).expect(200);
    });
  });
});
