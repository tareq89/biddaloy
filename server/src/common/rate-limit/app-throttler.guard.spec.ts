import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { buildFullPath, RequestMethodName } from '@test/helpers/route-path.helper';
import {
  FAIL_CLOSED,
  FAIL_OPEN,
  REDIS_OUTAGE_CONTROLLERS,
} from '@test/helpers/redis-outage-routes';
import { FAIL_CLOSED_WITHOUT_REDIS_KEY } from './app-throttler.guard';

function routes(): { route: string; failClosed: boolean }[] {
  const reflector = new Reflector();
  return REDIS_OUTAGE_CONTROLLERS.flatMap((ctrl) => {
    const prefix: string = Reflect.getMetadata(PATH_METADATA, ctrl);
    return Object.getOwnPropertyNames(ctrl.prototype).flatMap((name) => {
      const handler = ctrl.prototype[name];
      const path: string | undefined = Reflect.getMetadata(PATH_METADATA, handler);
      if (name === 'constructor' || path === undefined) return [];
      const method = RequestMethodName(Reflect.getMetadata(METHOD_METADATA, handler));
      return [
        {
          route: `${method} ${buildFullPath(prefix, path)}`,
          failClosed: !!reflector.getAllAndOverride<boolean>(FAIL_CLOSED_WITHOUT_REDIS_KEY, [
            handler,
            ctrl,
          ]),
        },
      ];
    });
  });
}

// The decorator fails open by default, so a new password- or code-checking route added without
// it would allow unlimited guesses while Redis is down. Every route on these controllers must be
// put in FAIL_CLOSED or FAIL_OPEN on purpose (75.18 review r2, F14).
describe('@FailClosedWithoutRedis() contract', () => {
  const all = routes();

  it('classifies every route as fail-closed or fail-open', () => {
    expect(all.map((r) => r.route).sort()).toEqual([...FAIL_CLOSED, ...FAIL_OPEN].sort());
  });

  it('is on exactly the FAIL_CLOSED routes', () => {
    const closed = all.filter((r) => r.failClosed).map((r) => r.route);
    expect(closed.sort()).toEqual([...FAIL_CLOSED].sort());
  });

  it('is on none of the FAIL_OPEN routes', () => {
    const open = all.filter((r) => !r.failClosed).map((r) => r.route);
    expect(open.sort()).toEqual([...FAIL_OPEN].sort());
  });
});
