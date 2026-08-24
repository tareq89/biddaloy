import { request, test as setup } from '@playwright/test';
import * as fs from 'node:fs';

import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS, SEED_ROLES } from '../seed-contract';
import { shells } from '../config';
import { AUTH_DIR, noTenantStatePath, storageStatePath } from './auth-paths';

/**
 * [8.5.2] Auth setup — runs once per shard as the `setup` project every
 * browser project depends on (`playwright.config.ts`). For each seed role
 * it logs in over the API (through the client dev server's `/api` proxy,
 * the same origin the browser uses), captures the httpOnly refresh cookie
 * via `storageState`, and merges a localStorage `origins` entry carrying
 * the active tenant so specs land in the app instead of `/select-school`.
 *
 * Credentials come only from `e2e/seed-contract.ts` — the server test
 * suite guards that contract against seed drift (`seed.util.spec.ts`).
 */

interface LoginMembership {
  tenantId: string;
  role: string;
  name: string;
}

/** Login is rate-limited (STRICT_RATE_LIMIT: 5/min per IP). The throttler
 * is skipped when the server runs NODE_ENV=test (app.module.ts), which is
 * how playwright.config.ts starts it — but a developer reusing their own
 * NODE_ENV=development server can still trip it, so on a 429 wait out the
 * window once and retry. State files are never reused across runs:
 * refresh tokens rotate on every use, so yesterday's cookie is a
 * reuse-detection trip waiting to happen. */
const THROTTLE_WINDOW_MS = 61_000;

setup('capture a storageState per seed role', async () => {
  setup.setTimeout(5 * 60 * 1000);
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) {
    throw new Error(
      `${SEED_PASSWORD_ENV} is not set — the seed accounts cannot be logged into. ` +
        'See server/.env.example and run the seed first.',
    );
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  for (const role of SEED_ROLES) {
    const statePath = storageStatePath(role);
    const ctx = await request.newContext({ baseURL: shells.app.baseURL });
    let response = await ctx.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS[role], password },
    });
    if (response.status() === 429) {
      await new Promise((resolve) => setTimeout(resolve, THROTTLE_WINDOW_MS));
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
    // The membership matching the seeded role — the admin account is
    // multi-membership (rose-valley-school), so "first" is not enough.
    const membership = body.memberships.find((m) => m.role === role.toUpperCase());
    if (!membership) {
      throw new Error(
        `No ${role.toUpperCase()} membership in login response for ${SEED_ROLE_EMAILS[role]}`,
      );
    }

    // Cookie-only state first (tenant picker specs), then the full state
    // with the persisted tenant merged in.
    const state = await ctx.storageState({ path: noTenantStatePath(role) });
    const withTenant = {
      ...state,
      origins: [
        {
          origin: shells.app.baseURL.replace(/\/$/, ''),
          localStorage: [
            {
              name: 'biddaloy:activeTenant',
              value: JSON.stringify({ tenantId: membership.tenantId, role: membership.role }),
            },
          ],
        },
      ],
    };
    fs.writeFileSync(statePath, JSON.stringify(withTenant, null, 2));
    await ctx.dispose();
  }
});
