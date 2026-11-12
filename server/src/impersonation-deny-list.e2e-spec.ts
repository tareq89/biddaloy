import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Controller, Get, Patch, Post, SetMetadata } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscoveryModule, DiscoveryService, MetadataScanner } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AppModule } from './app.module';
import { buildFullPath, RequestMethodName } from '@test/helpers/route-path.helper';

/**
 * Epic 99 safety net (D4): the routes an impersonating session may not call
 * are written down twice, in `impersonation-deny-list.snapshot.txt` (what is
 * marked) and in REQUIRED below (what must be marked). A route marked
 * `@DenyWhenImpersonating` that is not in the snapshot, or a REQUIRED route
 * that is not marked, fails CI. The metadata key is matched by string so this
 * spec compiles before the decorator exists (#3793). Value: `true` or
 * `{ bodyKeys: string[] }`.
 */

const DENY_KEY = 'denyWhenImpersonating';

type Entry = { route: string; bodyKeys?: string[] };

/** The D4 list. A `bodyKeys` entry means the mark is conditional on those body fields. */
const REQUIRED: Entry[] = [
  { route: 'POST /auth/change-password' },
  { route: 'POST /account/first-password' },
  { route: 'POST /users/:id/reset-password' },
  { route: 'DELETE /users/:id' },
  { route: 'POST /users' },
  { route: 'POST /users/join-requests' },
  { route: 'POST /users/invitations/batch' },
  { route: 'POST /users/:id/restore' },
  { route: 'POST /users/me/leave' },
  { route: 'POST /users/me/contact-change' },
  { route: 'POST /users/me/contact-change/confirm-phone' },
  { route: 'PATCH /users/:id', bodyKeys: ['email', 'phone'] },
  { route: 'POST /account/school-invites/:id/accept' },
  { route: 'POST /auth/step-up' },
  { route: 'POST /auth/step-up/otp/request' },
  { route: 'PATCH /schools/:id/settings', bodyKeys: ['communications'] },
  { route: 'POST /billing/orders' },
  { route: 'POST /billing/orders/:id/pay/bkash' },
  { route: 'POST /auth/logout-all' },
  { route: 'DELETE /auth/sessions/:id' },
];

/** Routes Wave 3 adds: required only once the route exists. */
const REQUIRED_WHEN_PRESENT: Entry[] = [
  { route: 'PUT /support-access/settings' },
  { route: 'POST /support-access/confirm' },
];

type Found = { route: string; mark: true | { bodyKeys: string[] } | undefined };

/** Every route with its deny mark (handler wins over controller class). */
function walk(controllers: Function[], scanner: MetadataScanner): Found[] {
  const found: Found[] = [];
  for (const metatype of controllers) {
    const prefix: string = Reflect.getMetadata(PATH_METADATA, metatype) ?? '';
    for (const methodName of scanner.getAllMethodNames(metatype.prototype)) {
      const handler = metatype.prototype[methodName];
      const httpMethod: number | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
      if (httpMethod === undefined) continue;
      const path = buildFullPath(prefix, Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      const mark =
        Reflect.getMetadata(DENY_KEY, handler) ?? Reflect.getMetadata(DENY_KEY, metatype);
      found.push({ route: `${RequestMethodName(httpMethod)} ${path}`, mark: mark || undefined });
    }
  }
  return found;
}

const keysOf = (mark: Found['mark']): string[] =>
  mark && typeof mark === 'object' ? [...(mark.bodyKeys ?? [])].sort() : [];

/** Sorted snapshot lines of the marked routes. */
function markedLines(found: Found[]): string[] {
  return found
    .filter((f) => f.mark)
    .map((f) => {
      const keys = keysOf(f.mark);
      return keys.length ? `${f.route} bodyKeys=${keys.join(',')}` : f.route;
    })
    .sort();
}

/** Problems for entries that exist as real routes but are unmarked or marked with the wrong keys. */
function unmarked(found: Found[], required: Entry[]): string[] {
  const problems: string[] = [];
  for (const r of required) {
    const hits = found.filter((f) => f.route === r.route);
    if (!hits.length) continue; // not a real route (yet)
    for (const h of hits) {
      if (!h.mark) problems.push(`${r.route} is not marked`);
      else if (!r.bodyKeys && h.mark !== true)
        problems.push(`${r.route} must be marked unconditionally`);
      else if (r.bodyKeys && r.bodyKeys.some((k) => !keysOf(h.mark).includes(k)))
        problems.push(`${r.route} must carry bodyKeys=${r.bodyKeys.join(',')}`);
    }
  }
  return problems;
}

// Throwaway fixture: never registered in the app.
@Controller('fixture')
class FixtureController {
  @Post('marked')
  @SetMetadata(DENY_KEY, true)
  marked() {
    return {};
  }

  @Patch('conditional')
  @SetMetadata(DENY_KEY, { bodyKeys: ['b', 'a'] })
  conditional() {
    return {};
  }

  @Get('plain')
  plain() {
    return {};
  }
}

describe('Impersonation deny-list manifest (Epic 99 safety net)', () => {
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

  it('marked routes match impersonation-deny-list.snapshot.txt', async () => {
    const found = walk(controllers, scanner);
    expect(found.length).toBeGreaterThan(100); // not vacuous
    const text =
      [
        '# routes marked @DenyWhenImpersonating — generated by server/src/impersonation-deny-list.e2e-spec.ts',
        '# update: yarn workspace @biddaloy/server test:file src/impersonation-deny-list.e2e-spec.ts -u   (then review the diff)',
        '# line format: METHOD /full/path [bodyKeys=a,b]   (empty until Epic 99 #3793 adds the decorator)',
        ...markedLines(found),
      ].join('\n') + '\n';
    await expect(text).toMatchFileSnapshot('./impersonation-deny-list.snapshot.txt');
  }, 60000);

  it('marks every D4 route that exists', () => {
    const found = walk(controllers, scanner);
    expect(unmarked(found, [...REQUIRED, ...REQUIRED_WHEN_PRESENT])).toEqual([]);
  });

  it('fixture: a marked route missing from the snapshot would fail test 1', () => {
    const lines = markedLines(walk([FixtureController], scanner));
    expect(lines).toEqual(['PATCH /fixture/conditional bodyKeys=a,b', 'POST /fixture/marked']);
  });

  it('fixture: a REQUIRED entry pointing at an unmarked route fails test 2', () => {
    const found = walk([FixtureController], scanner);
    expect(unmarked(found, [{ route: 'GET /fixture/plain' }])).toEqual([
      'GET /fixture/plain is not marked',
    ]);
    expect(unmarked(found, [{ route: 'PATCH /fixture/conditional', bodyKeys: ['c'] }])).toEqual([
      'PATCH /fixture/conditional must carry bodyKeys=c',
    ]);
    expect(unmarked(found, [{ route: 'POST /nowhere' }])).toEqual([]);
    // A conditional mark does not satisfy an unconditional entry.
    expect(unmarked(found, [{ route: 'PATCH /fixture/conditional' }])).toEqual([
      'PATCH /fixture/conditional must be marked unconditionally',
    ]);
  });
});
