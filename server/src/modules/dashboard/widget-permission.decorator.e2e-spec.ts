import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { Controller, INestApplication, Module, UseGuards, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DataSource } from 'typeorm';
import { DashboardWidgetKey, UserRole } from '@biddaloy/shared';
import { AppModule } from '../../app.module';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from '../../validation-pipe';
import { ContextGuard, RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { DashboardWidgetRoute } from './widget-permission.decorator';
import {
  SEED_TENANT_ID,
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_USER_ID,
  SEED_ADMIN_PASSWORD,
} from '@test/constants';

let handlerRuns = 0;

@Controller('widget-probe')
@UseGuards(AuthGuard('jwt'), ContextGuard, RolesGuard, PermissionsGuard)
class ProbeController {
  @DashboardWidgetRoute(DashboardWidgetKey.STAFF_TODAY)
  staff() {
    handlerRuns++;
    return { ok: true };
  }

  @DashboardWidgetRoute(DashboardWidgetKey.MY_LEAVE_BALANCE)
  leave() {
    handlerRuns++;
    return { ok: true };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

const ROLES = Object.values(UserRole);

describe('@DashboardWidgetRoute (probe controller, real guard stack)', () => {
  let app: INestApplication;
  let token: string;
  let dataSource: DataSource;
  const inserted: UserRole[] = [];
  const base = '/api/v1/widget-probe/dashboard/widgets';

  const call = (path: string, role: UserRole) =>
    supertest(app.getHttpServer())
      .get(`${base}/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-ID', SEED_TENANT_ID)
      .set('X-Role', role);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, ProbeModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();

    // One login, one membership per role, switched with X-Role. Remember what we insert so teardown
    // removes only those rows (the seed admin keeps its own memberships for other specs).
    dataSource = app.get(DataSource);
    for (const role of ROLES) {
      const rows: unknown[] = await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT DO NOTHING RETURNING role`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, role],
      );
      if (rows.length) inserted.push(role);
    }
    const login = await supertest(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: SEED_ADMIN_EMAIL, password: SEED_ADMIN_PASSWORD })
      .expect(200);
    token = login.body.access_token;
  }, 60000);

  afterAll(async () => {
    if (inserted.length) {
      await dataSource.query(
        `DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2 AND role = ANY($3)`,
        [SEED_ADMIN_USER_ID, SEED_TENANT_ID, inserted],
      );
    }
    await app.close();
  });

  describe('staff-today (ADMIN, EXECUTIVE, OFFICE_STAFF; needs STAFF_ATTENDANCE_READ)', () => {
    it.each([UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.OFFICE_STAFF])(
      '200 for %s',
      async (r) => {
        await call('staff-today', r).expect(200);
      },
    );

    // Holds the permission but is not in the catalogue roles (D46).
    it.each([
      UserRole.TEACHER,
      UserRole.ACCOUNTANT,
      UserRole.EXAM_CONTROLLER,
      UserRole.SUPER_ADMIN,
    ])('403 DASHBOARD_WIDGET_ROLE for %s', async (r) => {
      const res = await call('staff-today', r).expect(403);
      expect(res.body.details.code).toBe('DASHBOARD_WIDGET_ROLE');
    });

    // Lacks the permission: the ordinary permission 403, not the D46 code.
    it.each([UserRole.COMMITTEE, UserRole.PARENT, UserRole.STUDENT])(
      '403 permission for %s',
      async (r) => {
        const res = await call('staff-today', r).expect(403);
        expect(JSON.stringify(res.body)).not.toContain('DASHBOARD_WIDGET_ROLE');
      },
    );
  });

  describe('my-leave-balance (no extra permission)', () => {
    it.each([
      UserRole.TEACHER,
      UserRole.ACCOUNTANT,
      UserRole.OFFICE_STAFF,
      UserRole.EXAM_CONTROLLER,
    ])('200 for %s', async (r) => {
      await call('my-leave-balance', r).expect(200);
    });

    it.each([UserRole.ADMIN, UserRole.EXECUTIVE, UserRole.COMMITTEE])(
      '403 DASHBOARD_WIDGET_ROLE for %s',
      async (r) => {
        const res = await call('my-leave-balance', r).expect(403);
        expect(res.body.details.code).toBe('DASHBOARD_WIDGET_ROLE');
      },
    );
  });

  describe('auth and tenant', () => {
    it('401 without a token', async () => {
      await supertest(app.getHttpServer()).get(`${base}/staff-today`).expect(401);
    });

    it('rejects a tenant the caller does not belong to; handler never runs', async () => {
      const before = handlerRuns;
      const res = await supertest(app.getHttpServer())
        .get(`${base}/staff-today`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Tenant-ID', '00000000-0000-4000-8000-000000000999')
        .set('X-Role', UserRole.ADMIN);
      expect([401, 403]).toContain(res.status);
      expect(handlerRuns).toBe(before);
    });
  });
});
