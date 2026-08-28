/**
 * LHCI puppeteer script (#149): invoked once per URL before measuring.
 *
 * The app keeps the access token in memory and the refresh token in an
 * httpOnly cookie (ui/src/api/auth-state.ts, client.ts) — a fresh page
 * load re-authenticates from the cookie, so logging in once per browser
 * profile is enough; subsequent URLs reuse the cookie.
 *
 * Selectors mirror e2e/focus-management.spec.ts — the default locale is
 * Bangla, so labels are Bangla-first.
 */

// Both seeded users share SEED_ADMIN_PASSWORD (ensureRoleTestUsers,
// server/src/scripts/seed.util.ts). Two identities, not one, because
// `/portal` is guardian-only: client-admin/src/routes/portal.tsx redirects
// any non-guardian role to `/dashboard`, so measuring it as the admin would
// silently profile the staff dashboard twice and report it as the portal.
const IDENTITIES = {
  staff: 'admin@biddaloy.test',
  guardian: 'parent@biddaloy.test',
};
const PASSWORD = process.env.SEED_ADMIN_PASSWORD;

/** Which seeded user a URL has to be measured as. */
function identityFor(pathname) {
  return pathname.startsWith('/portal') ? 'guardian' : 'staff';
}

// The refresh token lives in an httpOnly cookie shared across pages in this
// browser profile, so one login per identity is enough — but switching
// identity means logging in again, which overwrites that cookie. Tracking the
// current identity (rather than a boolean) is what makes the order of URLs
// on the command line not matter.
let currentIdentity = null;

module.exports = async (browser, context) => {
  // The login page itself is measured unauthenticated.
  const { pathname } = new URL(context.url);
  if (pathname === '/login') return;

  const identity = identityFor(pathname);
  if (currentIdentity === identity) return;
  if (!PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD is not set — cannot log in for authenticated routes');
  }

  const page = await browser.newPage();
  await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle0' });

  // getByLabel equivalents: inputs are associated with Bangla labels.
  const email = await page.waitForSelector('aria/ইমেইল বা ফোন নম্বর');
  await email.type(IDENTITIES[identity]);
  const password = await page.waitForSelector('aria/পাসওয়ার্ড');
  await password.type(PASSWORD);
  const submit = await page.waitForSelector('aria/লগ ইন[role="button"]');
  await submit.click();

  // Logged in once the router leaves /login — but "left /login" is not the
  // same as "landed in the app". `admin@biddaloy.test` is seeded with a
  // second school on purpose (server/src/scripts/seed.ts) so the tenant-picker
  // E2E specs have a real picker to drive; with 2+ memberships `login()`
  // leaves the active tenant unset and `__root.tsx`'s guard sends the session
  // to `/select-school`. Closing the page here would leave the profile stuck
  // there, and every "authenticated" URL LHCI then measured would be redirected
  // to the picker — i.e. we would silently profile the wrong page, which is the
  // exact failure the staff/guardian split above exists to prevent.
  await page.waitForFunction(() => window.location.pathname !== '/login', { timeout: 15000 });

  if (new URL(page.url()).pathname === '/select-school') {
    // `SchoolPicker` preselects the first membership, so the submit button
    // alone resolves the tenant. Bangla label, like the fields above.
    const cont = await page.waitForSelector('aria/চালিয়ে যান[role="button"]');
    await cont.click();
    await page.waitForFunction(() => window.location.pathname !== '/select-school', {
      timeout: 15000,
    });
  }

  // Fail loudly. A profile that is still sitting on `/login` or
  // `/select-school` produces perfectly good Lighthouse numbers for a page
  // nobody asked about, and the budgets in `lighthouserc.cjs` would pass on
  // them. A thrown error stops the run instead.
  const landed = new URL(page.url()).pathname;
  if (landed === '/login' || landed === '/select-school') {
    await page.close();
    throw new Error(
      `Lighthouse auth for ${IDENTITIES[identity]} did not reach the app: still on ${landed}. ` +
        'Refusing to measure — the requested URL would have been redirected here.',
    );
  }

  await page.close();
  currentIdentity = identity;
};
