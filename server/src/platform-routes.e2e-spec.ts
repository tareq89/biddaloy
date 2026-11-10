import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildFullPath, RequestMethodName } from '@test/helpers/route-path.helper';

/**
 * Epic 98 safety net (D4): a route guarded as platform-only must live under
 * `platform/`. Guards are matched by class name so this spec compiles before
 * `PlatformAdminGuard` / `PlatformAccessGuard` exist. `ALLOWED_OUTSIDE` is
 * today's (2026-11-10) exceptions; Wave 3's route-move ticket empties it.
 */

const GUARDS_METADATA = '__guards__';
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';

const PLATFORM_GUARD_NAMES = new Set([
  'PlatformSuperAdminGuard',
  'PlatformAdminGuard',
  'PlatformAccessGuard',
]);

/** "METHOD /full/path" of platform-guarded routes that sit outside `platform/`. */
const ALLOWED_OUTSIDE: string[] = [
  'GET /schools',
  'GET /schools/:id/stats',
  'PATCH /schools/:id/status',
  'POST /schools/:id/revive',
  'POST /schools',
  'GET /schools/:id/sms-credits',
  'POST /schools/:id/sms-credits',
  'GET /schools/:id/admins',
  'POST /schools/:id/admins',
  'POST /schools/:id/admins/:userId/resend-invitation',
  'DELETE /schools/:id/admins/:userId/invitation',
];

const guardName = (guard: unknown): string =>
  typeof guard === 'function' ? guard.name : ((guard as object)?.constructor?.name ?? '');

/** Every platform-guarded route outside `platform/`, as a key plus a readable label. */
function platformRoutesOutsidePrefix(
  controllers: Function[],
  scanner: MetadataScanner,
): { key: string; label: string }[] {
  const found: { key: string; label: string }[] = [];
  for (const metatype of controllers) {
    const prefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
    const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, metatype) ?? [];
    for (const methodName of scanner.getAllMethodNames(metatype.prototype)) {
      const handler = metatype.prototype[methodName];
      const httpMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (httpMethod === undefined) continue;
      const guards = [...classGuards, ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])];
      if (!guards.some((g) => PLATFORM_GUARD_NAMES.has(guardName(g)))) continue;
      const path = buildFullPath(prefix, Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      if (path.startsWith('/platform/')) continue;
      const key = `${RequestMethodName(httpMethod)} ${path}`;
      found.push({ key, label: `${key} (${metatype.name}.${methodName})` });
    }
  }
  return found;
}

// Throwaway fixture: platform-guarded, path outside `platform/`. Never registered in the app.
class PlatformAdminGuard {}
@Controller('foo')
@UseGuards(PlatformAdminGuard)
class FixtureController {
  @Get()
  list() {
    return [];
  }
}

describe('Platform-only routes live under platform/ (Epic 98 safety net)', () => {
  let moduleRef: TestingModule;
  let controllers: Function[];
  let scanner: MetadataScanner;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    scanner = moduleRef.get(MetadataScanner);
    controllers = moduleRef
      .get(DiscoveryService)
      .getControllers()
      .map((w) => w.metatype)
      .filter((m): m is Function => !!m);
  }, 60000);

  afterAll(async () => {
    await moduleRef.close();
  });

  it('has no platform-guarded route outside platform/ beyond ALLOWED_OUTSIDE', () => {
    expect(controllers.length).toBeGreaterThan(30); // not vacuous
    const violations = platformRoutesOutsidePrefix(controllers, scanner)
      .filter((r) => !ALLOWED_OUTSIDE.includes(r.key))
      .map((r) => r.label);
    expect(violations).toEqual([]);
  });

  it('flags a new platform-guarded route outside platform/ (fixture)', () => {
    const keys = platformRoutesOutsidePrefix([FixtureController], scanner).map((r) => r.key);
    expect(keys).toEqual(['GET /foo']);
    expect(keys.filter((k) => !ALLOWED_OUTSIDE.includes(k))).not.toEqual([]);
  });

  it('keeps every ALLOWED_OUTSIDE entry pointed at a real platform-guarded route (list only shrinks)', () => {
    const live = new Set(platformRoutesOutsidePrefix(controllers, scanner).map((r) => r.key));
    expect(ALLOWED_OUTSIDE.filter((k) => !live.has(k))).toEqual([]);
  });
});
