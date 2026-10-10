import {
  request as playwrightRequest,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';

import { adminApiSession, createInvitedParentUser, E2E_PASSWORD } from '../api';
import { shells } from '../config';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import { ActivatePage } from '../pages/activate-page';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';

/**
 * [12.8] The "stolen phone" scenario: signing out one device's session from
 * another device, then proving the stolen device is actually cut off.
 *
 * Two independent logins as the **same** role, each its own refresh-token
 * family (`refresh-token.service.ts`'s rotation model — a session is a
 * family, not a row). The portal test mints and activates its **own**
 * STUDENT account rather than signing in as a seeded one: revoking "every
 * other session" would also sign out any parallel spec using the same
 * seeded login (`portal-applications.spec.ts` signs in as `student`), and a
 * fresh account starts with no stray sessions, so its baseline is a fixed
 * 0. Same pattern as `portal-account.spec.ts`'s password test. The staff
 * test still uses the seeded `teacher` (see its own baseline read).
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

/** A brand-new login (its own refresh family) as `credentials`, active in its `role` membership. */
async function freshSessionStorageState(
  credentials: { email: string; password: string } | { phone: string; password: string },
  role: string,
) {
  const ctx = await playwrightRequest.newContext({ baseURL: shells.app.baseURL });
  try {
    const response = await ctx.post('/api/v1/auth/login', { data: credentials });
    if (!response.ok()) {
      throw new Error(`Login failed: ${response.status()} ${await response.text()}`);
    }
    const body = (await response.json()) as {
      memberships: { tenantId: string; role: string; name: string }[];
    };
    const membership = body.memberships.find((m) => m.role === role);
    if (!membership) throw new Error(`No ${role} membership for this login`);
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

async function newLoggedInContext(
  browser: Browser,
  ...login: Parameters<typeof freshSessionStorageState>
): Promise<BrowserContext> {
  const storageState = await freshSessionStorageState(...login);
  return browser.newContext({ baseURL: shells.app.baseURL, storageState });
}

function seededTeacherLogin(): Parameters<typeof freshSessionStorageState> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) {
    throw new Error(`${SEED_PASSWORD_ENV} is not set — see server/.env.example.`);
  }
  return [{ email: SEED_ROLE_EMAILS.teacher, password }, 'TEACHER'];
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
 * than the two families the staff test itself creates — another spec's login
 * as the same shared seed role, or (on a retry) that same test's own
 * previous attempt, whose sessions were never server-side revoked even
 * though `deviceBContext.close()` below ends the browser context. Revoking
 * *every* non-current row, rather than guessing which one is "device A's",
 * is what makes the final "device A got signed out" assertion hold
 * regardless of how much of that pre-existing pollution is present.
 */
async function revokeAllOtherSessions(devicePage: Page): Promise<void> {
  // Locale-proof: the app's default locale is `bn` (`fixtures/test.ts`),
  // so matching the English "This device" badge or "Sign out —" label
  // never hits. `SessionCard` exposes `data-current` for exactly this, and
  // the revoke button is the only button inside a row.
  const otherRows = devicePage.locator('[data-testid="session-row"][data-current="false"]');
  // Assert on the *full* non-current count going down by one each pass —
  // `.first()` re-resolves to the next remaining row after a revoke, so
  // asserting that single locator reaches zero is wrong whenever more
  // than one stray row is present.
  let remaining = await otherRows.count();
  while (remaining > 0) {
    await otherRows.first().getByRole('button').click();
    await expect(otherRows).toHaveCount(remaining - 1);
    remaining -= 1;
  }
}

test.describe('Portal: sign out a stolen device from another device', () => {
  test.use(guest);

  test('revoking another session from a second device signs that device out', async ({
    page,
    browser,
    request,
  }) => {
    // `page` is "device A" — the one whose phone gets stolen. "Device B" is
    // a second, independent login as the same fresh account.
    const admin = await adminApiSession(request);
    const account = await createInvitedParentUser(request, admin, 'Sessions E2E', 'STUDENT');
    let deviceBContext: BrowserContext | undefined;

    try {
      await test.step('device A activates the account, establishing its own session', async () => {
        const activate = new ActivatePage(page);
        await activate.goto(account.token);
        await activate.setPassword(E2E_PASSWORD);
        await expect(page).toHaveURL(/\/portal/);
        await page.goto('/portal/account');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        // The only device so far: `SessionList` renders its empty state,
        // with no `session-row` at all.
        expect(await sessionRowCount(page)).toBe(0);
      });

      deviceBContext = await newLoggedInContext(
        browser,
        { phone: account.phone, password: E2E_PASSWORD },
        'STUDENT',
      );
      const deviceB = await deviceBContext.newPage();

      await test.step('device B opens the Devices card and sees both sessions', async () => {
        await deviceB.goto('/portal/account');
        const rows = deviceB.getByTestId('session-row');
        await expect(rows).toHaveCount(2);
        // Exactly one row is device B's own (`data-current="true"`); the
        // rest, including device A's, are the ones this test revokes below.
        await expect(rows.and(deviceB.locator('[data-current="true"]'))).toHaveCount(1);
      });

      await test.step("device B signs out device A's session", async () => {
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
        // The seeded `teacher` can already carry other live families (this
        // spec's own retries, or another spec's login as the same role), so
        // the baseline is whatever device A observes here, read *before*
        // device B logs in. A single-device account shows `SessionList`'s
        // empty state (no `session-row`), so a clean account reads 0, not 1.
        baselineCount = await sessionRowCount(page);
      });

      deviceBContext = await newLoggedInContext(browser, ...seededTeacherLogin());
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
