import type { APIRequestContext, Browser, Page, PlaywrightWorkerArgs } from '@playwright/test';

import bnSchool360 from '../../ui/src/i18n/locales/bn/school360.json';
import { adminApiSession, findSchoolIdBySlug, get, type ApiSession } from '../api';
import { shells } from '../config';
import { setModules } from '../fixtures/modules';
import { test } from '../fixtures/settings-lock';
import { cockpitOwner, expect } from '../fixtures/test';
import { t } from '../i18n';
import { ModulesWordsPage } from '../pages/modules-words-page';
import { AppShellPage } from '../pages/app-shell';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';

import { nextOwnerCode, ownerSession, tc } from './support-helpers';

/**
 * [Epic 77 / #3935] The platform layer of modules, end to end: the owner's "Modules for all
 * schools" card (Operations) and the school 360 "Modules" tab (per-school lock).
 *
 * WARNING: this spec changes PLATFORM-WIDE settings (the global module map) and the platform
 * lock of a seeded school. It takes the school-settings lock (fixtures/settings-lock.ts) per
 * test so no other spec sees "Fines off" or "Homework locked", and every test puts the global
 * map, the lock and the school choices back in `finally`. Never leave the map changed.
 *
 * Every write by the owner needs a step-up code (`platform.school_control`): the UI asks for
 * the authenticator code, the API calls take an approval token (`approvedPut`). Seed data only:
 * `Default School` (the one school admin's tests use) and `Rose Valley School` (same admin, a
 * second school, untouched by the locks below).
 */
test.use({ ...cockpitOwner, actionTimeout: 15_000 });

const ROSE_SLUG = 'rose-valley-school';
const SCOPE = 'platform.school_control';
// The server's refusal sentence (known-errors.ts MODULE_OFF_MESSAGE).
const REFUSAL = 'This part is not turned on for your institution';

const mod = (key: string) => t(`settings.modulesWords.moduleNames.${key}`);
/** school360 is not in `e2e/i18n.ts`: plain lookup in its bn catalog. */
const t360 = (key: string): string => {
  let node: unknown = bnSchool360;
  for (const part of key.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[part];
  }
  if (typeof node !== 'string') throw new Error(`missing i18n key school360:${key}`);
  return node;
};

function bearer(session: ApiSession): Record<string, string> {
  return { Authorization: `Bearer ${session.token}` };
}

/** `POST /platform/step-up` for `platform.school_control`; retries when another worker spent the step. */
async function approval(request: APIRequestContext, session: ApiSession): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const res = await request.post('/api/v1/platform/step-up', {
      headers: bearer(session),
      data: { scope: SCOPE, code: await nextOwnerCode() },
    });
    if (res.ok()) return ((await res.json()) as { approval_token: string }).approval_token;
    if (res.status() !== 401 || attempt >= 2) {
      throw new Error(`step-up ${res.status()} ${await res.text()}`);
    }
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 800));
  }
}

/** A platform write with a fresh approval token. */
async function approvedPut(
  request: APIRequestContext,
  session: ApiSession,
  path: string,
  data: object,
) {
  return request.put(`/api/v1${path}`, {
    headers: { ...bearer(session), 'X-Approval-Token': await approval(request, session) },
    data,
  });
}

const getPlatformMap = async (request: APIRequestContext, session: ApiSession) =>
  (await get<{ modules: Record<string, boolean> }>(request, session, '/platform/modules')).modules;

const getSchoolStates = async (request: APIRequestContext, session: ApiSession, schoolId: string) =>
  (
    await get<{ modules: Record<string, { on?: boolean; lock?: 'on' | 'off' }> }>(
      request,
      session,
      `/platform/schools/${schoolId}/modules`,
    )
  ).modules;

async function putPlatformMap(
  request: APIRequestContext,
  session: ApiSession,
  modules: Record<string, boolean>,
) {
  const res = await approvedPut(request, session, '/platform/modules', { modules });
  if (!res.ok()) throw new Error(`PUT /platform/modules ${res.status()} ${await res.text()}`);
}

async function putLock(
  request: APIRequestContext,
  session: ApiSession,
  schoolId: string,
  key: string,
  lock: 'on' | 'off' | null,
) {
  const res = await approvedPut(
    request,
    session,
    `/platform/schools/${schoolId}/modules/${key}/lock`,
    {
      lock,
    },
  );
  if (!res.ok()) throw new Error(`PUT lock ${res.status()} ${await res.text()}`);
}

/** The school's own API status for one route as ADMIN: 200 when the module is usable. */
async function status(request: APIRequestContext, session: ApiSession, path: string) {
  const res = await request.get(`/api/v1${path}`, {
    headers: { ...bearer(session), 'X-Tenant-ID': session.tenantId },
  });
  return { code: res.status(), body: res.ok() ? '' : await res.text() };
}

/** Seed ADMIN signed in over the API, with the token valid for `tenantId` (a second school). */
async function adminAt(request: APIRequestContext, tenantId: string): Promise<ApiSession> {
  const first = await adminApiSession(request);
  return { token: first.token, tenantId };
}

/** A browser of the school ADMIN on the app host, on `tenantId`: the school's own view. */
async function schoolAdminPage(
  browser: Browser,
  playwright: PlaywrightWorkerArgs['playwright'],
  tenantId: string,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const login = await api.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS.admin, password: process.env[SEED_PASSWORD_ENV] },
    });
    if (!login.ok()) throw new Error(`admin login ${login.status()} ${await login.text()}`);
    const state = await api.storageState();
    const groups = [
      'people',
      'academics',
      'attendance',
      'examsResults',
      'finance',
      'reports',
      'communications',
      'administration',
    ];
    const context = await browser.newContext({
      baseURL: shells.app.baseURL,
      storageState: {
        ...state,
        origins: [
          {
            origin: shells.app.baseURL.replace(/\/$/, ''),
            localStorage: [
              {
                name: 'biddaloy:activeTenant',
                value: JSON.stringify({ tenantId, role: 'ADMIN' }),
              },
              ...groups.map((g) => ({ name: `nav-group-collapsed-v2:${g}`, value: 'false' })),
            ],
          },
        ],
      },
    });
    return { page: await context.newPage(), close: () => context.close() };
  } finally {
    await api.dispose();
  }
}

/** The owner's code prompt: wait for it, then enter a code from a fresh step. */
async function enterCode(page: Page) {
  const field = page.getByLabel(tc('approval', 'codeOnly.label'));
  await expect(field).toBeVisible();
  await field.fill(await nextOwnerCode());
  await page.getByRole('button', { name: tc('approval', 'submit'), exact: true }).click();
  await expect(field).toHaveCount(0);
}

test.describe('platform modules', () => {
  test('Fines off for all schools: the school is refused and loses the menu item; back on restores it', async ({
    page,
    request,
    browser,
    playwright,
  }) => {
    test.setTimeout(150_000);
    const owner = await ownerSession(request);
    const admin = await adminApiSession(request);
    const before = await getPlatformMap(request, owner);
    const school = await schoolAdminPage(browser, playwright, admin.tenantId);
    try {
      await setModules(request, admin, { fines: { on: true } });
      const withoutFines = Object.fromEntries(
        Object.entries(before).filter(([k]) => k !== 'fines'),
      );
      await putPlatformMap(request, owner, withoutFines);
      expect((await status(request, admin, '/fees/fines')).code).toBe(200);
      const shell = new AppShellPage(school.page);
      await school.page.goto('/students');
      await shell.expectNavItem('nav.items.fines', true);

      // The owner turns Fines off for everyone: confirm, then the authenticator code.
      await page.goto('/operations');
      const card = page.getByRole('region', { name: t360('modules.global.title') });
      await card.getByRole('switch', { name: mod('fines'), exact: true }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: t360('modules.global.confirmAction'), exact: true })
        .click();
      await enterCode(page);
      await expect.poll(async () => (await getPlatformMap(request, owner)).fines).toBe(false);

      // The school: refused at the API, gone from the menu, "Turned off by platform", disabled.
      const refused = await status(request, admin, '/fees/fines');
      expect(refused.code).toBe(403);
      expect(refused.body).toContain(REFUSAL);
      await school.page.goto('/students');
      await shell.expectNavItem('nav.items.fines', false);
      const words = new ModulesWordsPage(school.page);
      await words.open('modules');
      await expect(words.moduleSwitch('fines')).toBeDisabled();
      await expect(words.moduleRow('fines')).toContainText(
        t('settings.modulesWords.modules.source.platformOff'),
      );
      // The school's own choice was not touched (D7).
      expect((await getSchoolStates(request, owner, admin.tenantId)).fines?.on).toBe(true);

      // Back on: the same card, no confirm, code only. The school's choice (On) is live again.
      await page.goto('/operations');
      await card.getByRole('switch', { name: mod('fines'), exact: true }).click();
      await enterCode(page);
      await expect.poll(async () => (await getPlatformMap(request, owner)).fines).toBeUndefined();
      expect((await status(request, admin, '/fees/fines')).code).toBe(200);
      await school.page.goto('/students');
      await shell.expectNavItem('nav.items.fines', true);
    } finally {
      await putPlatformMap(request, owner, before);
      await setModules(request, admin, { fines: null });
      await school.close();
    }
  });

  test('turning a module back on gives the school its own choice back (Off stays Off)', async ({
    request,
  }) => {
    test.setTimeout(90_000);
    const owner = await ownerSession(request);
    const admin = await adminApiSession(request);
    const before = await getPlatformMap(request, owner);
    try {
      await setModules(request, admin, { fines: { on: false } });
      await putPlatformMap(request, owner, { ...before, fines: false });
      expect((await getSchoolStates(request, owner, admin.tenantId)).fines?.on).toBe(false);
      await putPlatformMap(request, owner, before);
      // Platform is back on, the school said Off: still Off, still refused.
      expect((await getSchoolStates(request, owner, admin.tenantId)).fines?.on).toBe(false);
      expect((await status(request, admin, '/fees/fines')).code).toBe(403);
    } finally {
      await putPlatformMap(request, owner, before);
      await setModules(request, admin, { fines: null });
    }
  });

  test('School 360 Modules tab: lock Homework off for one school, the other is unaffected', async ({
    page,
    request,
    browser,
    playwright,
  }) => {
    test.setTimeout(150_000);
    const owner = await ownerSession(request);
    const admin = await adminApiSession(request);
    const roseId = await findSchoolIdBySlug(request, owner, ROSE_SLUG);
    expect(roseId).not.toBe(admin.tenantId);
    const rose = await adminAt(request, roseId);
    const school = await schoolAdminPage(browser, playwright, admin.tenantId);
    const lockSelect = () =>
      page.getByRole('combobox', {
        name: t360('modules.lock.selectLabel').replace('{{module}}', mod('homework')),
      });
    try {
      await setModules(request, admin, { homework: { on: true } });
      await setModules(request, rose, { homework: { on: true } });
      expect((await status(request, admin, '/homework')).code).toBe(200);
      const shell = new AppShellPage(school.page);
      await school.page.goto('/students');
      await shell.expectNavItem('nav.items.homework', true);

      await page.goto(`/schools/${admin.tenantId}?tab=modules`);
      await lockSelect().click();
      await page.getByRole('option', { name: t360('modules.lock.off'), exact: true }).click();
      await enterCode(page);
      await expect
        .poll(async () => (await getSchoolStates(request, owner, admin.tenantId)).homework?.lock)
        .toBe('off');

      // The locked school: refused although its own choice is On. The other school: untouched.
      expect((await status(request, admin, '/homework')).code).toBe(403);
      expect((await status(request, rose, '/homework')).code).toBe(200);
      expect((await getSchoolStates(request, owner, admin.tenantId)).homework?.on).toBe(true);
      await school.page.goto('/students');
      await shell.expectNavItem('nav.items.homework', false);

      // Remove the lock: back.
      await lockSelect().click();
      await page.getByRole('option', { name: t360('modules.lock.none'), exact: true }).click();
      await enterCode(page);
      await expect
        .poll(async () => (await getSchoolStates(request, owner, admin.tenantId)).homework?.lock)
        .toBeUndefined();
      expect((await status(request, admin, '/homework')).code).toBe(200);
      await school.page.goto('/students');
      await shell.expectNavItem('nav.items.homework', true);
    } finally {
      await putLock(request, owner, admin.tenantId, 'homework', null);
      await setModules(request, admin, { homework: null });
      await setModules(request, rose, { homework: null });
      await school.close();
    }
  });

  test('a school ADMIN cannot reach /platform/modules', async ({ request }) => {
    const admin = await adminApiSession(request);
    const headers = { ...bearer(admin), 'X-Tenant-ID': admin.tenantId };
    for (const res of [
      await request.get('/api/v1/platform/modules', { headers }),
      await request.put('/api/v1/platform/modules', { headers, data: { modules: {} } }),
      await request.get('/api/v1/platform/modules'),
    ]) {
      expect([401, 403]).toContain(res.status());
    }
  });
});
