import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { buildFullPath, RequestMethodName } from '@test/helpers/route-path.helper';
import { FAIL_CLOSED_WITHOUT_REDIS_KEY } from './app-throttler.guard';
import { AuthController } from '../../modules/auth/auth.controller';
import { StepUpController } from '../../modules/auth/step-up.controller';
import { SocialAuthController } from '../../modules/auth/social/social-auth.controller';
import { AccountAccessController } from '../../modules/account-access/account-access.controller';
import { RegistrationController } from '../../modules/registration/registration.controller';
import { UserController } from '../../modules/users/users.controller';

// Every controller under /auth/, plus the one that checks a password outside it.
const CONTROLLERS = [
  AuthController,
  StepUpController,
  SocialAuthController,
  AccountAccessController,
  RegistrationController,
  UserController,
];

// The routes that answered 503 under the old hand-kept string list, minus the three read-only
// social GETs (75.18 review r1, F11). A route that checks a password or a code and is missing
// here would fail open while Redis is down.
const FAIL_CLOSED = [
  'POST /auth/login',
  'POST /auth/change-password',
  'POST /auth/activate',
  'POST /auth/activate/resend',
  'POST /auth/activate/verify',
  'POST /auth/forgot-password',
  'POST /auth/reset-password',
  'POST /auth/otp/request',
  'POST /auth/otp/verify',
  'POST /auth/verify-email',
  'POST /auth/register/start',
  'POST /auth/register/resend',
  'POST /auth/register/verify',
  'POST /auth/step-up',
  'POST /auth/step-up/otp/request',
  'GET /auth/social/:provider/start',
  'GET /auth/social/:provider/callback',
  'POST /auth/social/:provider/link-start',
  'DELETE /auth/social/identities/:provider',
  'POST /auth/social/facebook/data-deletion',
  'POST /users/me/contact-change',
];

function routes(): { route: string; failClosed: boolean }[] {
  const reflector = new Reflector();
  return CONTROLLERS.flatMap((ctrl) => {
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

describe('@FailClosedWithoutRedis() contract', () => {
  const all = routes();

  it('is on exactly the password- and code-checking routes', () => {
    const closed = all.filter((r) => r.failClosed).map((r) => r.route);
    expect(closed.sort()).toEqual([...FAIL_CLOSED].sort());
  });

  // Signed-in people stay signed in (refresh tokens are DB rows), and reads stay readable.
  it.each([
    'POST /auth/refresh',
    'POST /auth/logout',
    'POST /auth/logout-all',
    'GET /auth/sessions',
    'DELETE /auth/sessions/:id',
    'GET /auth/social/providers',
    'GET /auth/social/identities',
    'GET /auth/social/facebook/data-deletion/status',
    'POST /users/me/contact-change/confirm-phone',
  ])('is not on %s', (route) => {
    expect(all.find((r) => r.route === route)).toEqual({ route, failClosed: false });
  });
});
