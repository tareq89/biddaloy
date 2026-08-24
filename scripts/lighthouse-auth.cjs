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

const ADMIN_EMAIL = 'admin@biddaloy.test'; // ensureRoleTestUsers, seed.util.ts
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

let loggedIn = false;

module.exports = async (browser, context) => {
  // The login page itself is measured unauthenticated.
  if (new URL(context.url).pathname === '/login') return;
  if (loggedIn) return;
  if (!ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD is not set — cannot log in for authenticated routes');
  }

  const page = await browser.newPage();
  await page.goto('http://localhost:5174/login', { waitUntil: 'networkidle0' });

  // getByLabel equivalents: inputs are associated with Bangla labels.
  const email = await page.waitForSelector('aria/ইমেইল বা ফোন নম্বর');
  await email.type(ADMIN_EMAIL);
  const password = await page.waitForSelector('aria/পাসওয়ার্ড');
  await password.type(ADMIN_PASSWORD);
  const submit = await page.waitForSelector('aria/লগ ইন[role="button"]');
  await submit.click();

  // Logged in once the router leaves /login.
  await page.waitForFunction(() => window.location.pathname !== '/login', { timeout: 15000 });
  await page.close();
  loggedIn = true;
};
