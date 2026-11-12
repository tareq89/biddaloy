import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { PlatformHomeService } from './modules/platform-identity/platform-home.service';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { buildFullPath, RequestMethodName } from '@test/helpers/route-path.helper';
import { mintCockpitToken, removeCockpitOwners } from '@test/helpers/cockpit-token.helper';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

/**
 * [Epic 98 wave 5, #3769] Platform authority lives in `platform_admins` only. A SUPER_ADMIN
 * membership, on an ordinary school or on the platform home school, must not reach ANY
 * platform-only route; a cockpit token must pass the guard on all of them.
 */
describe('Platform authority is cockpit-only (e2e)', () => {
  const PLATFORM_GUARDS = new Set(['PlatformAccessGuard', 'PlatformAdminGuard']);
  const UUID = '00000000-0000-4000-8000-0000000009fe';
  const TENANT_SA_EMAIL = 'tenant-sa@platform-authority-e2e.example';
  const HOME_SA_EMAIL = 'home-sa@platform-authority-e2e.example';
  const TENANT_SA_ID = '00000000-0000-4000-8000-0000000c0e01';
  const HOME_SA_ID = '00000000-0000-4000-8000-0000000c0e02';

  let moduleRef: TestingModule;
  let app: INestApplication;
  let ds: DataSource;
  let homeId: string;
  let routes: { method: string; path: string }[];

  const guardName = (g: unknown) =>
    typeof g === 'function' ? g.name : ((g as object)?.constructor?.name ?? '');

  const login = async (email: string) =>
    (
      await supertest(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: SEED_ADMIN_PASSWORD })
        .expect(200)
    ).body.access_token as string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    await app.init();
    ds = app.get(DataSource);

    const scanner = moduleRef.get(MetadataScanner);
    routes = [];
    for (const w of moduleRef.get(DiscoveryService).getControllers()) {
      const meta = w.metatype as Function | null;
      if (!meta) continue;
      const prefix: string = Reflect.getMetadata(PATH_METADATA, meta) ?? '';
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, meta) ?? [];
      for (const name of scanner.getAllMethodNames(meta.prototype)) {
        const handler = meta.prototype[name];
        const m: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (m === undefined) continue;
        const guards = [...classGuards, ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
        if (!guards.some((g) => PLATFORM_GUARDS.has(guardName(g)))) continue;
        const path = buildFullPath(prefix, Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        routes.push({ method: RequestMethodName(m).toLowerCase(), path });
      }
    }

    homeId = await app.get(PlatformHomeService).ensure();
    for (const [id, email, tenant] of [
      [TENANT_SA_ID, TENANT_SA_EMAIL, SEED_TENANT_ID],
      [HOME_SA_ID, HOME_SA_EMAIL, homeId],
    ] as const) {
      await ds.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Platform authority E2E', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, email, SEED_ADMIN_PASSWORD_HASH],
      );
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, tenant, UserRole.SUPER_ADMIN],
      );
    }
  }, 90000);

  afterAll(async () => {
    await removeCockpitOwners(ds);
    await ds.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [
      [TENANT_SA_ID, HOME_SA_ID],
    ]);
    await app.close();
  });

  const send = (r: { method: string; path: string }, token?: string, tenant?: string) => {
    const url = `/api/v1${r.path.replace(/:[A-Za-z]+/g, UUID)}`;
    let req = (supertest(app.getHttpServer()) as any)[r.method](url);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (tenant) req = req.set('X-Tenant-ID', tenant);
    return req.send({});
  };

  it('finds the platform routes (the scan is not blind)', () => {
    expect(routes.length).toBeGreaterThan(25);
    // The seven controllers moved off the legacy guard chain in #3769.
    for (const p of [
      '/platform/alerts',
      '/platform/attention/health',
      '/platform/backups',
      '/platform/billing/schools',
      '/platform/reports/usage',
      '/platform/holiday-sets',
    ]) {
      expect(routes.some((r) => r.path.startsWith(p))).toBe(true);
    }
  });

  it('[SECURITY] a tenant-local SUPER_ADMIN gets 401/403 on every platform route', async () => {
    const token = await login(TENANT_SA_EMAIL);
    for (const r of routes) {
      const status = (await send(r, token, SEED_TENANT_ID)).status;
      expect([401, 403], `${r.method} ${r.path}`).toContain(status);
    }
  }, 120000);

  it('[SECURITY] a SUPER_ADMIN of the platform home school gets 401/403 on every platform route', async () => {
    const token = await login(HOME_SA_EMAIL);
    for (const r of routes) {
      const status = (await send(r, token, homeId)).status;
      expect([401, 403], `${r.method} ${r.path}`).toContain(status);
    }
  }, 120000);

  it('no token gets 401 on every platform route', async () => {
    for (const r of routes) {
      expect((await send(r)).status, `${r.method} ${r.path}`).toBe(401);
    }
  }, 120000);

  it('a cockpit token passes the guard on every platform route (never 401/403 from a guard)', async () => {
    for (const r of routes) {
      // A fresh owner per route: logout-all and session routes end the session they are called with.
      const res = await send(r, await mintCockpitToken(app, ds));
      // The handler may answer 400/404/409 for the made-up id; a guard refusal reads this sentence.
      expect(res.body?.message, `${r.method} ${r.path}`).not.toBe(
        'This area is for platform owners only',
      );
      expect(res.status, `${r.method} ${r.path}`).not.toBe(401);
    }
  }, 120000);
});
