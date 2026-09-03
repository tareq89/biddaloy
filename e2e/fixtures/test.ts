import { request, test as base } from '@playwright/test';

import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS, type SeedRole } from '../seed-contract';
import { shells } from '../config';

export { expect } from '@playwright/test';

/**
 * [8.5.2] Fixture surface. Usage:
 *
 *   test.use(loggedIn('accountant'));                 // straight into the app
 *   test.use(loggedIn('admin', { tenant: 'none' }));  // lands on /select-school
 *   test.use(guest);                                  // login-page specs
 *
 * Why a fresh API login per test instead of the shared storageState files
 * the `setup` project writes: refresh tokens rotate on every use with
 * reuse detection (`refresh-token.service.ts` — 3 grace hops in a 10s
 * window, then the whole family is revoked). A cookie file shared by
 * several tests is therefore a security-mechanism trip wire, not a
 * session. Each test gets its own login → its own token family; the
 * `setup` project still runs once per shard as a fail-fast check that
 * every seed-contract credential actually works before browsers launch.
 * API login here is cheap: the server under test runs NODE_ENV=test,
 * where the login throttler is skipped (app.module.ts).
 */

interface LoginMembership {
  tenantId: string;
  role: string;
  name: string;
}

type StorageState = Awaited<
  ReturnType<Awaited<ReturnType<typeof request.newContext>>['storageState']>
>;

function localeEntry(locale: string) {
  return { name: 'biddaloy:locale', value: locale };
}

async function freshLogin(
  role: SeedRole,
  tenant: 'persisted' | 'none',
  locale: string,
): Promise<StorageState> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) {
    throw new Error(`${SEED_PASSWORD_ENV} is not set — see server/.env.example.`);
  }
  const ctx = await request.newContext({ baseURL: shells.app.baseURL });
  try {
    // journeys/portal-account.spec.ts's password-change test briefly
    // rotates the shared `parent` seed account's own password (change →
    // confirm → restore) — a real, if narrow, window where any other
    // spec's fresh `parent` login (this function, `fullyParallel: true`
    // means it can land mid-rotation) gets a legitimate 401 for a
    // credential that's correct again a moment later. Three attempts
    // over ~2s comfortably outlasts that window without masking an
    // actually-wrong seed password, which still fails after every retry.
    let response = await ctx.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS[role], password },
    });
    for (let attempt = 0; response.status() === 401 && attempt < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      response = await ctx.post('/api/v1/auth/login', {
        data: { email: SEED_ROLE_EMAILS[role], password },
      });
    }
    if (!response.ok()) {
      throw new Error(
        `Login failed for ${SEED_ROLE_EMAILS[role]}: ${response.status()} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as { memberships: LoginMembership[] };
    const membership = body.memberships.find((m) => m.role === role.toUpperCase());
    if (!membership) {
      throw new Error(
        `No ${role.toUpperCase()} membership in login response for ${SEED_ROLE_EMAILS[role]}`,
      );
    }
    const state = await ctx.storageState();
    const localStorage = [
      ...(tenant === 'none'
        ? []
        : [
            {
              name: 'biddaloy:activeTenant',
              value: JSON.stringify({ tenantId: membership.tenantId, role: membership.role }),
            },
          ]),
      ...(locale === 'bn' ? [] : [localeEntry(locale)]),
    ];
    if (localStorage.length === 0) return state;
    return {
      ...state,
      origins: [{ origin: shells.app.baseURL.replace(/\/$/, ''), localStorage }],
    };
  } finally {
    await ctx.dispose();
  }
}

interface AuthOptions {
  e2eRole: SeedRole | null;
  e2eTenant: 'persisted' | 'none';
  /** UI locale seeded into localStorage — 'bn' is the app default and
   * adds no entry. */
  e2eLocale: string;
}

export const test = base.extend<AuthOptions>({
  e2eRole: [null, { option: true }],
  e2eTenant: ['persisted', { option: true }],
  e2eLocale: ['bn', { option: true }],
  storageState: async ({ e2eRole, e2eTenant, e2eLocale }, use) => {
    if (!e2eRole) {
      if (e2eLocale === 'bn') {
        await use(undefined);
        return;
      }
      await use({
        cookies: [],
        origins: [
          {
            origin: shells.app.baseURL.replace(/\/$/, ''),
            localStorage: [localeEntry(e2eLocale)],
          },
        ],
      });
      return;
    }
    await use(await freshLogin(e2eRole, e2eTenant, e2eLocale));
  },
});

export function loggedIn(role: SeedRole, options: { tenant?: 'none' } = {}): Partial<AuthOptions> {
  return { e2eRole: role, e2eTenant: options.tenant === 'none' ? 'none' : 'persisted' };
}

/** Fresh, signed-out browser — login-page specs. */
export const guest: Partial<AuthOptions> = { e2eRole: null };
