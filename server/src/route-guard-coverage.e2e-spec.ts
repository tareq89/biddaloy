import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AppModule } from './app.module';
import { ContextGuard, RolesGuard } from './modules/auth/guards/context.guard';

/**
 * Regression coverage for the guard stack itself (#31): turns "remember to
 * add AuthGuard('jwt') + ContextGuard + RolesGuard to every new controller"
 * from a wish into a failing build. Walks every registered controller/route
 * via Nest's own DiscoveryService/MetadataScanner (the same machinery Nest
 * uses internally to wire routes) rather than grepping source text, so it
 * can't be fooled by a guard imported under an alias or reformatted
 * decorator syntax.
 */

const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

// AuthGuard(type) memoizes per type string in this @nestjs/passport version
// (verified empirically: two separate `AuthGuard('jwt')` calls return the
// *same* class reference) — so calling it here and comparing by reference
// reliably detects the exact guard every controller in this codebase uses,
// with no fragile name/string matching against a dynamically-generated
// mixin class.
const JWT_AUTH_GUARD = AuthGuard('jwt');

interface AllowlistEntry {
  controller: string;
  method: string;
  path: string;
  reason: string;
}

/**
 * A hardcoded, reviewed allowlist — not derived from any metadata — of
 * routes that deliberately do not carry the full guard stack. Adding a new
 * public or partially-guarded route requires a deliberate edit here, which
 * is the entire point: it can never happen by silent omission.
 *
 * The Swagger docs mount (`/api/docs`, `/api/docs-json`) is NOT listed here
 * because it isn't a Nest route at all — main.ts mounts it as raw Express
 * middleware via SwaggerModule.setup, invisible to DiscoveryService. Its
 * production access control (Basic Auth, gated by ENABLE_API_DOCS) is
 * covered separately by swagger-gating.e2e-spec.ts, not this test.
 */
const ALLOWLIST: AllowlistEntry[] = [
  {
    controller: 'AppController',
    method: 'GET',
    path: '/health',
    reason: 'Liveness probe — pre-authentication by definition.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/login',
    reason: 'Issues credentials in the first place — nothing to authenticate yet.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/complete-password-reset',
    reason:
      'Pre-authentication password replacement uses a short-lived reset-purpose JWT; a temporary password never receives a normal session.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/refresh',
    reason:
      'Cookie-authenticated, pre-tenant-selection (SameOriginGuard only) — see the README\'s "CSRF posture" section.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/logout',
    reason:
      'Cookie-authenticated, pre-tenant-selection (SameOriginGuard only), same rationale as /auth/refresh.',
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/logout-all',
    reason:
      "Bearer-authenticated but tenant-agnostic — operates on the caller's own user.sub/jti (AuthGuard(jwt) only, no ContextGuard/RolesGuard, since it is not a tenant-scoped resource).",
  },
  {
    controller: 'AuthController',
    method: 'POST',
    path: '/auth/change-password',
    reason:
      "Bearer-authenticated but tenant-agnostic — rotates the caller's own password, identified solely by user.sub, and takes no user id from the body (AuthGuard(jwt) only, same rationale as /auth/logout-all).",
  },
  {
    controller: 'DeviceIngestController',
    method: 'POST',
    path: '/attendance/device-events',
    reason:
      'Device-authenticated (X-Device-Key) — no JWT, no user, no tenant header. Tenant is ' +
      'resolved from the device row by DeviceAuthGuard; RolesGuard is deliberately absent ' +
      'because a device holds no UserRole. See [9.5].',
  },
  {
    controller: 'DeviceIngestController',
    method: 'GET',
    path: '/attendance/devices/me/roster',
    reason:
      'Device-authenticated (X-Device-Key) — no JWT, no user, no tenant header. Tenant is ' +
      'resolved from the device row by DeviceAuthGuard; RolesGuard is deliberately absent ' +
      'because a device holds no UserRole. See [9.5].',
  },
  {
    controller: 'DeviceIngestController',
    method: 'POST',
    path: '/attendance/devices/me/heartbeat',
    reason:
      'Device-authenticated (X-Device-Key) — no JWT, no user, no tenant header. Tenant is ' +
      'resolved from the device row by DeviceAuthGuard; RolesGuard is deliberately absent ' +
      'because a device holds no UserRole. See [9.5].',
  },
];

function findAllowlistEntry(
  controller: string,
  method: string,
  path: string,
): AllowlistEntry | undefined {
  return ALLOWLIST.find(
    (entry) => entry.controller === controller && entry.method === method && entry.path === path,
  );
}

describe('Route guard coverage (regression)', () => {
  let moduleRef: TestingModule;
  let discoveryService: DiscoveryService;
  let metadataScanner: MetadataScanner;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();

    discoveryService = moduleRef.get(DiscoveryService);
    metadataScanner = moduleRef.get(MetadataScanner);
  }, 60000);

  afterAll(async () => {
    await moduleRef.close();
  });

  it('requires AuthGuard(jwt) + ContextGuard + RolesGuard on every route not on the reviewed allowlist', () => {
    const controllers = discoveryService.getControllers();
    const checked: string[] = [];
    const violations: string[] = [];

    for (const wrapper of controllers) {
      const { metatype } = wrapper;
      // Not `instance` — a REQUEST/TRANSIENT-scoped controller has no
      // singleton instance to speak of (Nest defers construction to
      // per-request), and skipping on that basis would silently exempt it
      // from this test entirely. metatype.prototype is available
      // regardless of scope, since routes/guards are decorator metadata
      // on the class itself, not on any particular instance.
      if (!metatype) continue;

      const controllerName = metatype.name;
      const controllerPrefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];

      const prototype = metatype.prototype;
      const methodNames = metadataScanner.getAllMethodNames(prototype);

      for (const methodName of methodNames) {
        const handler = prototype[methodName];
        const httpMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (httpMethod === undefined) continue; // not a route handler (e.g. a private helper method)

        const routePath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        const allGuards = [...classGuards, ...methodGuards];

        const fullPath = buildFullPath(controllerPrefix, routePath);
        const methodLabel = RequestMethodName(httpMethod);
        checked.push(`${methodLabel} ${fullPath} (${controllerName})`);

        const hasFullStack =
          allGuards.includes(JWT_AUTH_GUARD) &&
          allGuards.includes(ContextGuard) &&
          allGuards.includes(RolesGuard);

        if (hasFullStack) continue;

        const allowlisted = findAllowlistEntry(controllerName, methodLabel, fullPath);
        if (allowlisted) continue;

        violations.push(
          `${methodLabel} ${fullPath} (${controllerName}.${methodName}) — missing guard stack ` +
            `(has: ${describeGuards(allGuards)}) and is not on the allowlist`,
        );
      }
    }

    // A sanity floor so a DiscoveryService/metadata regression that silently
    // returns zero controllers can't make this test pass vacuously.
    expect(checked.length).toBeGreaterThan(30);
    expect(violations).toEqual([]);
  });

  it('keeps every allowlist entry pointed at a route that still exists', () => {
    const controllers = discoveryService.getControllers();
    const existingRoutes = new Set<string>();

    for (const wrapper of controllers) {
      const { metatype } = wrapper;
      if (!metatype) continue;

      const controllerName = metatype.name;
      const controllerPrefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
      const prototype = metatype.prototype;

      for (const methodName of metadataScanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        const httpMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (httpMethod === undefined) continue;

        const routePath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const fullPath = buildFullPath(controllerPrefix, routePath);
        existingRoutes.add(`${controllerName}|${RequestMethodName(httpMethod)}|${fullPath}`);
      }
    }

    const stale = ALLOWLIST.filter(
      (entry) => !existingRoutes.has(`${entry.controller}|${entry.method}|${entry.path}`),
    );
    expect(stale).toEqual([]);
  });
});

// Nest stores '/' as an index route's own path metadata (e.g. bare
// `@Get()`), which `filter(Boolean)` keeps (it's a non-empty string) — left
// alone, that produces a trailing slash (`/students/`) that would never
// match a human writing `/students` into the allowlist by hand. Stripped
// here, once, so every path this file produces is the same shape a person
// would naturally write.
function buildFullPath(controllerPrefix: string, routePath: string): string {
  return `/${[controllerPrefix, routePath].filter(Boolean).join('/')}`
    .replace(/\/+/g, '/')
    .replace(/(.)\/$/, '$1');
}

// Nest's RequestMethod enum (from @nestjs/common) — duplicated as a small
// literal map rather than imported, since only the numeric value stored in
// route metadata is available here and this keeps the mapping self-evident.
function RequestMethodName(method: number): string {
  const names: Record<number, string> = {
    0: 'GET',
    1: 'POST',
    2: 'PUT',
    3: 'DELETE',
    4: 'PATCH',
    5: 'ALL',
    6: 'OPTIONS',
    7: 'HEAD',
  };
  return names[method] ?? `UNKNOWN(${method})`;
}

function describeGuards(guards: unknown[]): string {
  if (guards.length === 0) return 'none';
  return guards
    .map((g) => {
      if (g === JWT_AUTH_GUARD) return "AuthGuard('jwt')";
      if (typeof g === 'function') return g.name || '(anonymous)';
      return String(g);
    })
    .join(', ');
}
