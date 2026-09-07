import {
  request as playwrightRequest,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS, type SeedRole } from '../seed-contract';

/**
 * [12.8] The "stolen phone" scenario: signing out one device's session from
 * another device, then proving the stolen device is actually cut off.
 *
 * Two independent logins as the **same** role, each its own refresh-token
 * family (`refresh-token.service.ts`'s rotation model — a session is a
 * family, not a row). `student` is used, not `parent` — `portal-account
 * .spec.ts:9-16` explains why: `parent` is the busiest seeded credential in
 * this suite (several other specs sign in as it), and any spec that
 * mutates its session state risks poisoning those. `student` carries no
 * such risk here since this spec only revokes a *session*, not the
 * password (unlike `portal-account.spec.ts`'s own reason for picking
 * `student` over `parent` for its password-rotation test).
 *
 * **Why the assertion after revoke is a full page load, not a client-side
 * navigation:** revoking a family kills its refresh token, but the
 * device's already-issued *access* token stays valid for up to ~15 minutes
 * — so a click inside the already-booted SPA would keep working right up
 * until that access token happens to expire, making this test flaky by
 * timing. What fails immediately is the **bootstrap refresh that runs on a
 * full page load**: the e2e fixture's `storageState` only ever seeds the
 * refresh-token cookie, never an access token (`fixtures/test.ts`), so a
 * fresh `page.goto(...)` has nothing to render with until that bootstrap
 * refresh succeeds — and with the family revoked, it can't. Do not "fix"
 * this back to a link click; that would silently stop testing the
 * `DELETE /auth/sessions/:id` contract at all.
 */

async function freshSessionStorageState(role: SeedRole) {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) {
    throw new Error(`${SEED_PASSWORD_ENV} is not set — see server/.env.example.`);
  }
  const ctx = await playwrightRequest.newContext({ baseURL: shells.app.baseURL });
  try {
    const response = await ctx.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS[role], password },
    });
    if (!response.ok()) {
      throw new Error(
        `Login failed for ${SEED_ROLE_EMAILS[role]}: ${response.status()} ${await response.text()}`,
      );
    }
    const body = (await response.json()) as {
      memberships: { tenantId: string; role: string; name: string }[];
    };
    const membership = body.memberships.find((m) => m.role === role.toUpperCase());
    if (!membership) {
      throw new Error(`No ${role.toUpperCase()} membership for ${SEED_ROLE_EMAILS[role]}`);
    }
    const state = await ctx.storageState();
    return {
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
  } finally {
    await ctx.dispose();
  }
}

async function newLoggedInContext(browser: Browser, role: SeedRole): Promise<BrowserContext> {
  const storageState = await freshSessionStorageState(role);
  return browser.newContext({ baseURL: shells.app.baseURL, storageState });
}

/**
 * Device A's baseline session-row count, read once its Devices UI has
 * actually settled. `SessionList` renders skeletons while loading and an
 * empty state (zero `session-row`s) when only the current device is live,
 * so a bare `.count()` straight after `goto` could race the skeleton and
 * read 0 for the wrong reason. Waiting for the loading region to go away
 * first makes the number trustworthy either way.
 */
async function sessionRowCount(devicePage: Page): Promise<number> {
  await expect(devicePage.locator('[aria-busy="true"]')).toHaveCount(0);
  return devicePage.getByTestId('session-row').count();
}

/**
 * Clicks every non-current row's "Sign out" button, one at a time, until
 * only the current device is left. The seeded role here can carry more
 * than the two families this test itself creates — another spec's login
 * as the same shared seed role, or (on a retry) this same test's own
 * previous attempt, whose sessions were never server-side revoked even
 * though `deviceBContext.close()` below ends the browser context. Revoking
 * *every* non-current row, rather than guessing which one is "device A's",
 * is what makes the final "device A got signed out" assertion hold
 * regardless of how much of that pre-existing pollution is present.
 */
async function revokeAllOtherSessions(devicePage: Page): Promise<void> {
  const otherRows = devicePage
    .getByTestId('session-row')
    .filter({ hasNot: devicePage.getByText('This device') });
  // Assert on the *full* non-current count going down by one each pass —
  // `.first()` re-resolves to the next remaining row after a revoke, so
  // asserting that single locator reaches zero is wrong whenever more
  // than one stray row is present.
  let remaining = await otherRows.count();
  while (remaining > 0) {
    await otherRows
      .first()
      .getByRole('button', { name: /Sign out —/ })
      .click();
    await expect(otherRows).toHaveCount(remaining - 1);
    remaining -= 1;
  }
}

test.describe('Portal: sign out a stolen device from another device', () => {
  test.use(loggedIn('student'));

  test('revoking another session from a second device signs that device out', async ({
    page,
    browser,
  }) => {
    // `page` (from the `loggedIn('student')` fixture) is "device A" — the
    // one whose phone gets stolen. "Device B" is a second, independent
    // login as the same account — created only *after* device A has read
    // its baseline below, otherwise B's own family is already in that
    // baseline and the `+ 1` assertion is off by one.
    let deviceBContext: BrowserContext | undefined;

    try {
      let baselineCount = 0;

      await test.step('device A boots into the portal, establishing its own session', async () => {
        await page.goto('/portal/account');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // The seeded `student` account can already carry other live
        // families from elsewhere in the suite (this spec's own retries,
        // or another spec's login as the same seed role) — so the baseline
        // is whatever device A observes here, not a hardcoded 1. Note the
        // single-device case renders `SessionList`'s empty state with no
        // `session-row` at all, so a clean account reads as 0 here, not 1.
        baselineCount = await sessionRowCount(page);
      });

      deviceBContext = await newLoggedInContext(browser, 'student');
      const deviceB = await deviceBContext.newPage();

      await test.step('device B opens the Devices card and sees one more session than device A did', async () => {
        await deviceB.goto('/portal/account');
        const rows = deviceB.getByTestId('session-row');
        // With device B added there are always at least two live
        // families, so the list (not the empty state) is guaranteed here.
        await expect(rows).toHaveCount(Math.max(baselineCount, 1) + 1);
        // Exactly one row is device B's own ("This device"); the rest,
        // including device A's, are the ones this test revokes below.
        await expect(rows.filter({ has: deviceB.getByText('This device') })).toHaveCount(1);
      });

      await test.step("device B signs out device A's session (and any other stray one)", async () => {
        await revokeAllOtherSessions(deviceB);
        // Down to just the current device — `SessionList` swaps to its
        // empty state at that point (`onlyCurrentDevice`, session-list.tsx),
        // so there is no longer a `session-row` at all, not one.
        await expect(deviceB.getByTestId('session-row')).toHaveCount(0);
      });

      await test.step('device A is redirected to /login on its next full page load', async () => {
        // A client-side navigation would not fail here — see this file's
        // own header comment for why a full page load is required.
        await page.goto('/portal/account');
        await expect(page).toHaveURL(/\/login/);
      });
    } finally {
      await deviceBContext?.close();
    }
  });
});

test.describe('Staff: sign out a device from /security', () => {
  test.use(loggedIn('teacher'));

  test('revoking another session from /security signs that device out', async ({
    page,
    browser,
  }) => {
    let deviceBContext: BrowserContext | undefined;

    try {
      let baselineCount = 0;

      await test.step('device A boots into the staff shell', async () => {
        await page.goto('/security');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // See the portal journey's own comments above on why this is a
        // dynamic baseline read *before* device B logs in.
        baselineCount = await sessionRowCount(page);
      });

      deviceBContext = await newLoggedInContext(browser, 'teacher');
      const deviceB = await deviceBContext.newPage();

      await test.step('device B opens /security and revokes the other session(s)', async () => {
        await deviceB.goto('/security');
        await expect(deviceB.getByTestId('session-row')).toHaveCount(
          Math.max(baselineCount, 1) + 1,
        );

        await revokeAllOtherSessions(deviceB);
        // See the portal journey's own comment above on the empty-state swap.
        await expect(deviceB.getByTestId('session-row')).toHaveCount(0);
      });

      await test.step('device A is redirected to /login on its next full page load', async () => {
        await page.goto('/security');
        await expect(page).toHaveURL(/\/login/);
      });
    } finally {
      await deviceBContext?.close();
    }
  });
});
