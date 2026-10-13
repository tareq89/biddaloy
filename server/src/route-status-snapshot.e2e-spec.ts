import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest = require('supertest');
import { Test, TestingModule } from '@nestjs/testing';
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  INestApplication,
  NestInterceptor,
  ValidationPipe,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { AppModule } from './app.module';
import { buildFullPath, RequestMethodName } from './route-guard-coverage.e2e-spec';
import { configureApiVersioning } from '@test/helpers/e2e-app.helper';
import { buildValidationPipeOptions } from './validation-pipe';
import { SEED_TENANT_ID, SEED_ADMIN_PASSWORD, SEED_ADMIN_PASSWORD_HASH } from '@test/constants';

const SNAPSHOT_EMAIL = 'route-snapshot@biddaloy.test';
const SNAPSHOT_USER_ID = '00000000-0000-4000-8000-0000000e7532';
const SENTINEL = 299;
const PLATFORM_EMAIL = 'route-snapshot-platform@biddaloy.test';
const PLATFORM_USER_ID = '00000000-0000-4000-8000-0000000e7533';
// Column = who sends the request. TENANT_SA is a SUPER_ADMIN membership on the seed tenant
// (legacy shape); PLATFORM_SA is SUPER_ADMIN on the platform tenant (slug default-school),
// sending that tenant's id in X-Tenant-ID, as the real platform console does.
type Column = { name: string; role?: UserRole; platform?: boolean };
const COLUMNS: Column[] = [
  { name: 'ANON' },
  { name: 'PLATFORM_SA', role: UserRole.SUPER_ADMIN, platform: true },
  ...Object.values(UserRole).map((role) => ({
    name: role === UserRole.SUPER_ADMIN ? 'TENANT_SA' : role,
    role,
  })),
];
const col = (name: string) => COLUMNS.find((c) => c.name === name)!;
const BATCH = 20;

/**
 * Guards-only interceptor: runs after every guard, before pipes and the handler.
 * Throwing (instead of returning) lets the exception filter write the response,
 * so `@Res()` routes cannot hang. Off until the sweep starts so login still works.
 */
let guardsOnly = false;
class GuardsPassedInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler) {
    if (!guardsOnly) return next.handle();
    throw new HttpException('route-snapshot: guards passed', SENTINEL);
  }
}

/**
 * [75.32] Role x route guard snapshot. Sends a real request per route and role; the
 * guards answer, the handler never runs. Update with `-u` and review the diff
 * (see "Route status snapshot" in server/CLAUDE.md).
 */
describe('Route status snapshot (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let token: string;
  let platformToken: string;
  let platformId: string;
  let createdPlatformSchool = false;
  let server: ReturnType<INestApplication['getHttpServer']>;

  const send = async (method: string, path: string, c: Column): Promise<string> => {
    let req = supertest(server)
      [method.toLowerCase() as 'get'](path)
      .set('X-Tenant-ID', c.platform ? platformId : SEED_TENANT_ID)
      .timeout({ response: 15000, deadline: 20000 });
    if (c.role) {
      req = req
        .set('Authorization', `Bearer ${c.platform ? platformToken : token}`)
        .set('X-Role', c.role);
    }
    try {
      const res = await req;
      return res.status === SENTINEL ? 'PASS' : String(res.status);
    } catch (e) {
      // supertest throws on timeout; record it so a hang shows as a diff, not a hung suite.
      return `ERR(${(e as Error).message.slice(0, 30)})`;
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(new ValidationPipe(buildValidationPipeOptions()));
    app.useGlobalInterceptors(new GuardsPassedInterceptor());
    // Listen once: supertest on an unbound server opens one ephemeral server per request,
    // which resets under 20 concurrent requests.
    await app.listen(0);
    server = app.getHttpServer();
    dataSource = app.get(DataSource);

    // Own user, one membership per role; inserted before login (the JWT embeds memberships).
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Route Snapshot', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [SNAPSHOT_USER_ID, SNAPSHOT_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    for (const role of Object.values(UserRole)) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SNAPSHOT_USER_ID, SEED_TENANT_ID, role],
      );
    }
    // Second user, platform authority only, so the TENANT_SA column stays tenant-local.
    await dataSource.query(
      `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'Route Snapshot Platform', 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PLATFORM_USER_ID, PLATFORM_EMAIL, SEED_ADMIN_PASSWORD_HASH],
    );
    const inserted = await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       SELECT $1, 'Platform', 'default-school', NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM schools WHERE slug = 'default-school') RETURNING id`,
      [randomUUID()],
    );
    createdPlatformSchool = inserted.length > 0;
    platformId = (await dataSource.query(`SELECT id FROM schools WHERE slug = 'default-school'`))[0]
      .id;
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'SUPER_ADMIN', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [PLATFORM_USER_ID, platformId],
    );
    const login = async (email: string) =>
      (
        await supertest(server)
          .post('/api/v1/auth/login')
          .send({ email, password: SEED_ADMIN_PASSWORD })
          .expect(200)
      ).body.access_token;
    token = await login(SNAPSHOT_EMAIL);
    platformToken = await login(PLATFORM_EMAIL);
    guardsOnly = true;
  }, 60000);

  afterAll(async () => {
    guardsOnly = false;
    // beforeAll may have failed before these were set; do not mask its error.
    if (dataSource) {
      const ids = [SNAPSHOT_USER_ID, PLATFORM_USER_ID];
      await dataSource.query(`DELETE FROM refresh_tokens WHERE user_id = ANY($1)`, [ids]);
      await dataSource.query(`DELETE FROM user_tenants WHERE user_id = ANY($1)`, [ids]);
      await dataSource.query(`DELETE FROM users WHERE id = ANY($1)`, [ids]);
      if (createdPlatformSchool) {
        await dataSource.query(`DELETE FROM schools WHERE id = $1`, [platformId]);
      }
    }
    await app?.close();
  });

  it('GET /api/health/ready (@Res route) answers without hanging', async () => {
    const status = await send('GET', '/api/health/ready', 'ANON');
    expect(status).not.toMatch(/^ERR/);
  });

  it('one row proves both outcomes: attention health is PASS / 403 / 401', async () => {
    const p = '/api/v1/platform/attention/health';
    expect(await send('GET', p, col('PLATFORM_SA'))).toBe('PASS');
    expect(await send('GET', p, col('ADMIN'))).toBe('403');
    expect(await send('GET', p, col('ANON'))).toBe('401');
  });

  it('platform routes: PLATFORM_SA passes, a tenant-local SUPER_ADMIN is denied', async () => {
    const p = '/api/v1/schools';
    expect(await send('GET', p, col('PLATFORM_SA'))).toBe('PASS');
    expect(await send('GET', p, col('TENANT_SA'))).toBe('403');
  });

  it('every route x role answers as recorded in route-status.snapshot.txt', async () => {
    const discovery = app.get(DiscoveryService);
    const scanner = app.get(MetadataScanner);
    const routes: { method: string; path: string; label: string }[] = [];
    for (const { metatype } of discovery.getControllers()) {
      if (!metatype) continue;
      const prefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
      const classVersion = Reflect.getMetadata(VERSION_METADATA, metatype);
      for (const name of scanner.getAllMethodNames(metatype.prototype)) {
        const handler = metatype.prototype[name];
        const m: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (m === undefined) continue;
        const version = Reflect.getMetadata(VERSION_METADATA, handler) ?? classVersion;
        const base = `/api${version === VERSION_NEUTRAL ? '' : '/v1'}`;
        const template = buildFullPath(prefix, Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        routes.push({
          method: RequestMethodName(m),
          // Request path: every :param becomes the seed tenant id (same-tenant branch in guards).
          path: base + template.replace(/:[A-Za-z0-9_]+/g, SEED_TENANT_ID),
          // Snapshot path: keeps :param so lines stay short and readable.
          label: base + template,
        });
      }
    }
    // Default sort = UTF-16 code-unit order: identical on every machine.
    routes.sort((a, b) =>
      a.label !== b.label
        ? a.label < b.label
          ? -1
          : 1
        : a.method < b.method
          ? -1
          : a.method > b.method
            ? 1
            : 0,
    );

    const rows: string[][] = [];
    for (let i = 0; i < routes.length; i += BATCH) {
      rows.push(
        ...(await Promise.all(
          routes
            .slice(i, i + BATCH)
            .map((r) => Promise.all(COLUMNS.map((c) => send(r.method, r.path, c)))),
        )),
      );
    }

    expect(rows.flat().filter((c) => c.startsWith('ERR'))).toEqual([]);
    const mw = Math.max(...routes.map((r) => r.method.length));
    const pw = Math.max(...routes.map((r) => r.label.length));
    const text =
      [
        '# role x route guard snapshot — generated by server/src/route-status-snapshot.e2e-spec.ts',
        '# update: yarn workspace @biddaloy/server test:file src/route-status-snapshot.e2e-spec.ts -u   (then review the diff)',
        `# columns: ${COLUMNS.map((c) => c.name).join(' ')}`,
        ...routes.map(
          (r, i) => `${r.method.padEnd(mw)} ${r.label.padEnd(pw)} ${rows[i].join(' ')}`,
        ),
      ].join('\n') + '\n';
    await expect(text).toMatchFileSnapshot('./route-status.snapshot.txt');
  }, 300000);
});
