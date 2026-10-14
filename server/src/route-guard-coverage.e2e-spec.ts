import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { AppModule } from './app.module';
import { ContextGuard, RolesGuard } from './modules/auth/guards/context.guard';
import { PermissionsGuard } from './modules/auth/guards/permissions.guard';
import {
  ALLOWLIST,
  AllowlistEntry,
  buildFullPath,
  describeGuards,
  JWT_AUTH_GUARD,
  RequestMethodName,
} from '@test/helpers/route-path.helper';

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

  it('requires AuthGuard(jwt) + ContextGuard + RolesGuard + PermissionsGuard on every route not on the reviewed allowlist', () => {
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
          allGuards.includes(RolesGuard) &&
          allGuards.includes(PermissionsGuard);

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

  it('runs guards in order ContextGuard, RolesGuard, PermissionsGuard on every route', () => {
    const controllers = discoveryService.getControllers();
    const violations: string[] = [];

    for (const wrapper of controllers) {
      const { metatype } = wrapper;
      if (!metatype) continue;

      const controllerName = metatype.name;
      const controllerPrefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];
      const prototype = metatype.prototype;

      for (const methodName of metadataScanner.getAllMethodNames(prototype)) {
        const handler = prototype[methodName];
        const httpMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (httpMethod === undefined) continue;

        const routePath: string = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const methodGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        const allGuards = [...classGuards, ...methodGuards];

        if (!allGuards.includes(PermissionsGuard)) continue;

        const fullPath = buildFullPath(controllerPrefix, routePath);
        const methodLabel = RequestMethodName(httpMethod);
        const contextIndex = allGuards.indexOf(ContextGuard);
        const rolesIndex = allGuards.indexOf(RolesGuard);
        const permissionsIndex = allGuards.indexOf(PermissionsGuard);

        if (!(contextIndex < rolesIndex && rolesIndex < permissionsIndex)) {
          violations.push(
            `${methodLabel} ${fullPath} (${controllerName}.${methodName}) — guards must run in ` +
              `order ContextGuard, RolesGuard, PermissionsGuard (has: ${describeGuards(allGuards)})`,
          );
        }
      }
    }

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
