import { UserRole } from '@biddaloy/shared';

import { adminApiSession, createClassSection, post } from '../api';
import { setModules } from '../fixtures/modules';
import { test } from '../fixtures/settings-lock';
import { expect, loggedIn } from '../fixtures/test';
import { t } from '../i18n';
import { AppShellPage } from '../pages/app-shell';

/**
 * [Epic 77 / #3922] A module that is off disappears from every surface and its URL shows the
 * refusal page. Modules are school-wide, so each test puts them back in `finally`, and the
 * "off" window is kept short for the specs running beside this one.
 *
 * Takes the school-settings lock (fixtures/settings-lock.ts) per test: modules are school-wide
 * and other specs change them too, so they must not overlap across workers.
 *
 * Propagation (D27): the server reads the module state from the school row on every request,
 * so a switch applies at once. The page learns of it when the school-profile query refetches:
 * its `staleTime` is 30 s and a refetch fires on window focus once stale. The test moves the
 * page clock past that and fires the focus event, then polls for the result (no sleeps).
 */
// The palette action's bn label (`fines.log` in client-admin/src/action-registry.ts); actions
// carry inline labels, not i18n keys. e2e runs in bn.
const LOG_FINE = 'জরিমানা যোগ করুন';
const FINES_OFF = { fines: { on: false } };
const FINES_BACK = { fines: null };

const finesLink = (page: import('@playwright/test').Page) =>
  page
    .getByRole('navigation', { name: t('nav.navLabel') })
    .getByRole('link', { name: t('nav.items.fines'), exact: true });

test.describe('admin', () => {
  test.use(loggedIn('admin'));

  test('Fines off: sidebar, palette, student tab and URL', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const chain = await createClassSection(request, session);
    const student = await post<{ id: string }>(request, session, '/students', {
      full_name: `E2E Mod ${Date.now()}`,
      class_section_id: chain.sectionId,
    });
    const shell = new AppShellPage(page);
    const finesTab = () =>
      page.getByRole('tab', { name: t('students.detail.tabs.fines'), exact: true });
    try {
      // On first: the surfaces exist.
      await page.goto(`/students/${student.id}`);
      await shell.expectNavItem('nav.items.fines', true);
      await expect(finesTab()).toBeVisible();
      await shell.openGlobalSearch();
      await shell.switchToActionTab();
      await shell.searchFor(LOG_FINE);
      await expect(page.getByRole('option', { name: LOG_FINE })).toBeVisible();
      await page.keyboard.press('Escape');

      await setModules(request, session, FINES_OFF);
      await page.goto(`/students/${student.id}`);
      await shell.expectNavItem('nav.items.fines', false);
      await expect(finesTab()).toHaveCount(0);

      await shell.openGlobalSearch();
      await shell.switchToActionTab();
      await shell.searchFor(LOG_FINE);
      await expect(page.getByRole('option', { name: LOG_FINE })).toHaveCount(0);
      await page.keyboard.press('Escape');

      await page.goto('/fees/fines');
      await expect(page.getByText(t('common.moduleOff.title'))).toBeVisible();
      // ADMIN is offered the fix.
      await expect(
        page.getByRole('link', { name: t('common.moduleOff.turnOn'), exact: true }),
      ).toBeVisible();
    } finally {
      await setModules(request, session, FINES_BACK);
    }
  });

  test('a switch reaches an already-open page after the profile refetches', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const shell = new AppShellPage(page);
    const refetchOnFocus = async () => {
      // Past the 30 s `staleTime`, then the visibility event TanStack Query listens to.
      await page.clock.fastForward(31_000);
      // TanStack Query listens on `window`, so the event has to bubble up from `document`.
      await page.evaluate(() =>
        document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
      );
    };
    await page.clock.install();
    try {
      await page.goto('/students');
      await shell.expectNavItem('nav.items.fines', true);

      await setModules(request, session, FINES_OFF);
      // Still on the cached profile: nothing has told the page yet.
      await shell.expectNavItem('nav.items.fines', true);

      await refetchOnFocus();
      await expect.poll(() => finesLink(page).count()).toBe(0);

      // And back on, the same way.
      await setModules(request, session, FINES_BACK);
      await refetchOnFocus();
      await expect.poll(() => finesLink(page).count()).toBe(1);
    } finally {
      await setModules(request, session, FINES_BACK);
    }
  });

  test('Homework off for TEACHER stays visible for ADMIN', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const shell = new AppShellPage(page);
    try {
      await setModules(request, session, { homework: { offForRoles: [UserRole.TEACHER] } });
      await page.goto('/students');
      await shell.expectNavItem('nav.items.homework', true);
    } finally {
      await setModules(request, session, { homework: null });
    }
  });
});

test.describe('teacher', () => {
  test.use(loggedIn('teacher'));

  test('Homework off for TEACHER: hidden, with "Ask your admin"', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const shell = new AppShellPage(page);
    try {
      await page.goto('/students');
      await shell.expectNavItem('nav.items.homework', true);

      await setModules(request, session, { homework: { offForRoles: [UserRole.TEACHER] } });
      await page.goto('/students');
      await shell.expectNavItem('nav.items.homework', false);

      await page.goto('/academics/homework');
      await expect(page.getByText(t('common.moduleOff.title'))).toBeVisible();
      await expect(page.getByText(t('common.moduleOff.askAdmin'))).toBeVisible();
      await expect(page.getByRole('link', { name: t('common.moduleOff.turnOn') })).toHaveCount(0);
    } finally {
      await setModules(request, session, { homework: null });
    }
  });
});

test.describe('parent portal', () => {
  test.use(loggedIn('parent'));

  // The portal has no whole-page refusal yet: a hidden portal URL shows the generic load error
  // (the server still answers 403). Reported as a follow-up, so only the link is asserted here.
  test('Routines off: the portal link is gone', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const shell = new AppShellPage(page);
    try {
      await page.goto('/portal');
      await shell.expectNavItem('nav.items.portalRoutine', true);

      await setModules(request, session, { routines: { on: false } });
      await page.goto('/portal');
      await shell.expectNavItem('nav.items.portalRoutine', false);
    } finally {
      await setModules(request, session, { routines: null });
    }
  });
});
