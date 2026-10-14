import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import manifest from '../route-manifest.json';

import { CONSOLE_ERROR_ALLOWLIST, KNOWN_ISSUES } from './sweep-allowlist';

/**
 * [58.4.02] Nightly demo sweep. Runs only in the opt-in `demo-nightly` project (see
 * `playwright.config.ts`): each demo login card signs in, then visits every manifest route that
 * role may see. Any 5xx response, error boundary or console error fails the run, and the nightly
 * reset (58.4.01) must not swap the new database in.
 *
 * "May see" = the route's permission (`STAFF_ROUTE_PERMISSIONS`) is held by the role. Guardians
 * and students (the portal roles) get the `/portal` routes instead. Overlays are skipped (too
 * slow). A route with one `$param` opens the first matching link on its list page; routes with
 * several params (marks, results, ACR) and details with no row to click are listed as skipped.
 *
 * Branch switching is never used, so the guardian bug #2509 (data stays stale after a switch)
 * cannot make this sweep fail.
 */
const routes = (manifest as { routes: { path: string }[] }).routes.map((r) => r.path);

/**
 * Playwright would compile `@biddaloy/shared` from source (decorators break), so the role table
 * comes from its built output (`yarn workspace @biddaloy/shared build`), and the route -> permission
 * table is read as text from `client-admin/src/route-permissions.ts`.
 */
const root = join(__dirname, '..', '..');
const { roleHasPermission } = createRequire(__filename)(join(root, 'shared/dist/index.js')) as {
  roleHasPermission: (role: string, permission: string) => boolean;
};
/** The login cards, in the order the login screen shows them (read as text, like the file above). */
const DEMO_CARDS = [
  ...readFileSync(join(root, 'server/src/modules/demo/demo-accounts.ts'), 'utf8').matchAll(
    /key: '([^']+)',\s*role: '([^']+)'/g,
  ),
].map((m) => ({ key: m[1]!, role: m[2]! }));

const STAFF_ROUTE_PERMISSIONS = Object.fromEntries(
  [
    ...readFileSync(join(root, 'client-admin/src/route-permissions.ts'), 'utf8').matchAll(
      /'(\/_staff\/[^']*)':\s*Permission\.(\w+)/g,
    ),
  ].map((m) => [m[1]!, m[2]!]),
);

/** `/students/$studentId_/edit` and `/students/$id/edit` both become `/students/$/edit`. */
const shape = (p: string) => p.replace(/\$\w+_?/g, '$').replace(/(.)\/$/, '$1');
const permissionByShape = new Map(
  Object.entries(STAFF_ROUTE_PERMISSIONS).map(([id, perm]) => [
    shape(id.replace('/_staff', '')),
    perm,
  ]),
);

function routesFor(role: string): string[] {
  if (role === 'PARENT' || role === 'STUDENT') {
    return routes.filter((p) => p === '/portal' || p.startsWith('/portal/'));
  }
  return routes.filter((p) => {
    const perm = permissionByShape.get(shape(p));
    return perm !== undefined && roleHasPermission(role, perm);
  });
}

async function signIn(page: Page, index: number) {
  await page.goto('/login');
  await page.getByRole('button', { name: /Try:/ }).nth(index).click();
  await expect(page).toHaveURL(/\/(select-school|dashboard|portal)/);
  if (/\/select-school/.test(page.url())) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/(login|select-school)/);
}

/** `/students/$studentId/edit` -> the first `/students/<id>` link on `/students`, plus `/edit`. */
async function resolveDetail(page: Page, path: string): Promise<string | null> {
  const segments = path.split('/');
  const at = segments.findIndex((s) => s.startsWith('$'));
  if (segments.filter((s) => s.startsWith('$')).length !== 1) return null;
  const listPath = segments.slice(0, at).join('/') || '/';
  const rest = segments.slice(at + 1).join('/');
  await page.goto(listPath);
  await page.waitForLoadState('networkidle');
  const hrefs = await page
    .locator(`main a[href^="${listPath}/"]`)
    .evaluateAll((els) => els.map((a) => a.getAttribute('href') ?? ''));
  const depth = at + 1; // segments of the detail href, e.g. ['', 'students', '<id>']
  // An id is a UUID: `/students/import` is a sibling page, not a student.
  const href = hrefs.find((h) => {
    const parts = h.split(/[?#]/)[0]!.split('/');
    return parts.length === depth && /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(parts[at]!);
  });
  return href ? (rest ? `${href}/${rest}` : href) : null;
}

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));
});

DEMO_CARDS.forEach((card, index) => {
  test(`${card.key}: no 5xx, error boundary or console error @nightly`, async ({ page }) => {
    test.setTimeout(8 * 60_000); // the project's globalTimeout (8 min for all roles) is the real cap
    const started = Date.now();
    const problems: string[] = [];
    let where = 'login';
    const clientErrors = new Set<string>();
    page.on('response', (r) => {
      const line = `${where}: ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`;
      if (r.status() >= 500) problems.push(line);
      // Not a failure: a 4xx on a route the role may see is a UI/API permission mismatch worth
      // reading in the log. The anonymous 401 probe on /login is expected.
      else if (r.status() >= 400 && where !== 'login') clientErrors.add(line);
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      // The browser logs every failed request as "Failed to load resource: ... status of N";
      // the response handler above already judges the status.
      if (m.text().startsWith('Failed to load resource')) return;
      if (CONSOLE_ERROR_ALLOWLIST.some((a) => a.pattern.test(m.text()))) return;
      problems.push(`${where}: console.error ${m.text().slice(0, 200)}`);
    });
    page.on('pageerror', (e) => problems.push(`${where}: uncaught ${e.message.slice(0, 200)}`));

    await signIn(page, index);
    const paths = routesFor(card.role);
    expect(paths.length, `no routes for ${card.key}`).toBeGreaterThan(0);

    const skipped: string[] = [];
    for (const path of paths) {
      where = path;
      const target = path.includes('$') ? await resolveDetail(page, path) : path;
      if (!target) {
        skipped.push(path);
        continue;
      }
      where = target;
      await page.goto(target);
      await page.waitForLoadState('networkidle');
      if (await page.locator('[data-slot="error-state"]').count()) {
        const known = KNOWN_ISSUES.find((k) => k.path === path);
        if (known) clientErrors.add(`${target}: error boundary tolerated, ${known.reason}`);
        else problems.push(`${target}: error boundary`);
      }
    }
    const note = `${paths.length - skipped.length}/${paths.length} routes visited, skipped: ${skipped.join(' ') || 'none'}`;
    test.info().annotations.push({ type: 'visited', description: note });
    for (const line of clientErrors) console.log(`[demo-nightly] ${card.key} 4xx/known: ${line}`);
    console.log(
      `[demo-nightly] ${card.key}: ${note} in ${Math.round((Date.now() - started) / 1000)}s`,
    );
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
