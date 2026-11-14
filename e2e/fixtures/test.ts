import { request, test as base } from '@playwright/test';

import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS, type SeedRole } from '../seed-contract';
import { cockpitSignIn } from '../api';
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

// [30.1.3]: staff nav groups now start collapsed unless they own the
// active route (ui/src/components/app-shell.tsx `readGroupCollapsed`).
// Almost every spec that isn't specifically testing that behavior wants
// the old always-visible sidebar — seed every group's stored preference
// to expanded here, once, rather than patching each affected spec.
const STAFF_NAV_GROUP_IDS = [
  'people',
  'academics',
  'attendance',
  'examsResults',
  'finance',
  'reports',
  'communications',
  'administration',
];

function expandedNavGroupEntries() {
  return STAFF_NAV_GROUP_IDS.map((id) => ({
    name: `nav-group-collapsed-v2:${id}`,
    value: 'false',
  }));
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
    // Deliberately a single attempt, no 401 retry. An earlier version
    // retried to ride out `journeys/portal-account.spec.ts`'s password
    // rotation, which used to move a SHARED seeded credential; that test
    // now changes the password of an account it mints itself, so a 401
    // here means the seed password is genuinely wrong and is worth
    // failing on immediately. Retrying only bought a slower,
    // noisier failure (nine 401s per fixture in the CI log) and hid which
    // test had stranded the account.
    const response = await ctx.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS[role], password },
    });
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
      ...expandedNavGroupEntries(),
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

/** The platform console's own host (`isCockpitHost()` in the SPA): `*.localhost` is loopback. */
export const COCKPIT_URL = process.env.E2E_COCKPIT_URL ?? 'http://cockpit.localhost:5174';

/** [98.5.09] A fresh cockpit sign-in of the seeded platform owner: cookies on the cockpit host. */
async function cockpitLogin(locale: string): Promise<StorageState> {
  const ctx = await request.newContext({ baseURL: COCKPIT_URL });
  try {
    await cockpitSignIn(ctx);
    const state = await ctx.storageState();
    if (locale === 'bn') return state;
    return { ...state, origins: [{ origin: COCKPIT_URL, localStorage: [localeEntry(locale)] }] };
  } finally {
    await ctx.dispose();
  }
}

export interface AuthOptions {
  /** Signed in as the platform owner on the cockpit host (instead of a school role). */
  e2eCockpit: boolean;
  e2eRole: SeedRole | null;
  e2eTenant: 'persisted' | 'none';
  /** UI locale seeded into localStorage — 'bn' is the app default and
   * adds no entry. */
  e2eLocale: string;
}

export const test = base.extend<AuthOptions>({
  e2eCockpit: [false, { option: true }],
  e2eRole: [null, { option: true }],
  e2eTenant: ['persisted', { option: true }],
  e2eLocale: ['bn', { option: true }],
  baseURL: async ({ baseURL, e2eCockpit }, use) => {
    await use(e2eCockpit ? COCKPIT_URL : baseURL);
  },
  storageState: async ({ e2eRole, e2eTenant, e2eLocale, e2eCockpit }, use) => {
    if (e2eCockpit) {
      await use(await cockpitLogin(e2eLocale));
      return;
    }
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

/** The platform owner on the cockpit host: `test.use(cockpitOwner)`. School specs never use it. */
export const cockpitOwner: Partial<AuthOptions> = { e2eCockpit: true };

/** Fresh, signed-out browser — login-page specs. */
export const guest: Partial<AuthOptions> = { e2eRole: null };
