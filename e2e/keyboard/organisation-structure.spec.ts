import type { BrowserContext, Page } from '@playwright/test';

import {
  activateInvite,
  post,
  provisionSchool,
  resendSchoolAdminInvitation,
  superAdminApiSession,
} from '../api';
import { shells } from '../config';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { focusedText, tabUntilFocused } from './keyboard-utils';

/**
 * Opens a focused Radix `Select` trigger, picks `value` by typeahead, and
 * waits for the listbox to actually finish closing before returning.
 *
 * Radix's close animation leaves the listbox (and the option Enter just
 * landed on) in the DOM and focus-trapped for a few hundred ms after the
 * value has already visibly changed — proceeding to the next `Tab` before
 * that finishes silently keeps cycling inside the closing listbox instead
 * of reaching the field after it. `toBeHidden()` also passes once the
 * listbox has left the DOM entirely, not just when it's visually hidden.
 */
async function selectByTypeahead(page: Page, value: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
}

/**
 * [33.5.1] Shift/version/group, KEYBOARD ONLY: add a shift in Settings,
 * save, create a class using it, then filter the class list by it. No
 * `page.mouse` and no `.click(` call anywhere in this file.
 *
 * Runs against a *dedicated* tenant provisioned over the API
 * (`provisionSchool`/`activateInvite`, same pattern as
 * `journeys/backup-restore.spec.ts`), not the shared seeded one: [D5] hides
 * the class form's shift field until the tenant has 2+ shifts configured,
 * so this journey has to add two — and `playwright.config.ts`'s
 * `fullyParallel: true` means writing two shifts onto the shared
 * `default-school` tenant could race another worker's spec reading that
 * tenant's vocabulary mid-run. `api.ts`'s own `markableDateIso` comment
 * steers specs away from touching shared tenant settings for the same
 * reason; a dedicated tenant sidesteps it entirely instead of adding
 * cleanup this file would still have to get right under parallelism.
 */
test.describe('organisation structure', () => {
  test.setTimeout(60_000);

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const schoolName = `E2E Org School ${suffix}`;
  const schoolSlug = `e2e-org-school-${suffix}`;
  const adminEmail = `org-admin-${suffix}@e2e.example.com`;
  const shiftOne = `Prabhati ${suffix}`;
  const shiftTwo = `Dibashi ${suffix}`;
  const className = `E2E Kbd Class ${suffix}`.slice(0, 50);
  const yearName = `E2E Kbd Year ${suffix}`;

  let adminContext: BrowserContext;
  let adminPage: Page;

  test.beforeAll(async ({ browser, playwright }) => {
    const setupRequest = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    try {
      const superAdmin = await superAdminApiSession(setupRequest);
      const provisioned = await provisionSchool(
        setupRequest,
        superAdmin,
        schoolName,
        schoolSlug,
        'Org Admin',
        adminEmail,
      );
      const inviteToken = await resendSchoolAdminInvitation(
        setupRequest,
        superAdmin,
        provisioned.schoolId,
        provisioned.adminUserId,
      );
      const activated = await activateInvite(setupRequest, inviteToken, 'A-strong-org-pw-1');
      const adminSession = { token: activated.token, tenantId: activated.tenantId };

      // The class form needs an academic year to attach to (`academicYearId`
      // is a required field) — creating one is bookkeeping, not the feature
      // this journey proves, so it's seeded over the API like every other
      // keyboard spec seeds its scaffolding (`createStudentsInSection`,
      // `createTeacherForSection`).
      await post(setupRequest, adminSession, '/academic-years', {
        name: yearName,
        start_date: '2026-01-01',
        end_date: '2026-12-31',
      });

      const state = await setupRequest.storageState();
      adminContext = await browser.newContext({
        storageState: {
          ...state,
          origins: [
            {
              origin: shells.app.baseURL.replace(/\/$/, ''),
              localStorage: [
                {
                  name: 'biddaloy:activeTenant',
                  value: JSON.stringify({
                    tenantId: activated.tenantId,
                    role: activated.role,
                  }),
                },
                // [30.1.3]: both nav groups this journey needs start
                // collapsed unless they own the active route — same
                // pre-seed `journeys/keyboard/attendance.spec.ts` uses for
                // its own group, so the journey never spends a Tab/Enter
                // pair expanding a group instead of reaching a link.
                { name: 'nav-group-collapsed-v2:administration', value: 'false' },
                { name: 'nav-group-collapsed-v2:academics', value: 'false' },
              ],
            },
          ],
        },
      });
    } finally {
      await setupRequest.dispose();
    }
    adminPage = await adminContext.newPage();
  });

  test.afterAll(async () => {
    await adminContext.close();
  });

  test('add a shift, create a class with it, then filter by it — no mouse', async () => {
    const page = adminPage;

    await test.step('skip link, then keyboard-navigate to Settings', async () => {
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.evaluate(() => {
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: t('nav.skipToContent') })).toBeFocused();
      // Same "toggle button shares the link's label" seam
      // `keyboard/attendance.spec.ts` already documents — pin to the link.
      await tabUntilFocused(page, t('nav.items.settings'), 60, { tag: 'a' });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: t('settings.title') })).toBeVisible();
      // The organisation section only renders once `useSchoolSettings`
      // resolves (`SchoolSettingsPage`'s `{schoolId && settingsQuery.data
      // && (...)}` gate) — waited for explicitly rather than folded into
      // the Tab search below, so a slow first fetch fails with a clear
      // "never appeared" message instead of a misleading "not reachable by
      // Tab" one.
      await expect(page.getByText(t('settings.organisation.legend'))).toBeVisible();
    });

    await test.step('add two shifts and save (D5 hides the class-form field under two)', async () => {
      // `SchoolSettingsPage` renders School Profile, Backup, Regional,
      // Calendar and Attendance sections before Organisation — a lot of
      // real focusable fields, not a fixed handful, so this reach needs a
      // generous ceiling rather than the ~60 a single-section page needs.
      await tabUntilFocused(page, t('settings.organisation.addPlaceholder'), 200, {
        tag: 'INPUT',
      });
      await page.keyboard.type(shiftOne);
      await page.keyboard.press('Tab');
      expect(await focusedText(page)).toBe(t('settings.organisation.addAction'));
      await page.keyboard.press('Enter');

      // One Shift+Tab back onto the same Add input — the input/button pair
      // is always the last two focusable elements in the shifts fieldset,
      // so this reaches it directly without a second `tabUntilFocused`
      // search through the newly-added entry's own Rename/Remove buttons.
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.type(shiftTwo);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');

      await tabUntilFocused(page, t('settings.save.action'), 60, { tag: 'BUTTON' });
      await page.keyboard.press('Enter');
      await expect(page.getByText(t('settings.save.success'))).toBeVisible();
    });

    await test.step('keyboard-navigate to Classes', async () => {
      await page.evaluate(() => {
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });
      await page.keyboard.press('Tab');
      // [30.1.3] The classes nav item's label is the plural entity noun
      // (`useEntityLabel('class', { count: 2 })`), not `nav.items.classes`
      // — that key exists but this item doesn't use it.
      await tabUntilFocused(page, t('common.entities.class_other'), 60, { tag: 'a' });
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: t('classes.list.title') })).toBeVisible();
    });

    await test.step('create a class with the first shift, without touching the mouse', async () => {
      await tabUntilFocused(page, t('classes.list.addClass'), 60, { tag: 'BUTTON' });
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('heading', { name: t('classes.classForm.createTitle') }),
      ).toBeVisible();

      await tabUntilFocused(page, t('classes.classForm.nameLabel'), 20, { tag: 'INPUT' });
      await page.keyboard.type(className);

      await tabUntilFocused(page, t('classes.classForm.academicYearLabel'), 20, {
        tag: 'BUTTON',
      });
      await selectByTypeahead(page, yearName);

      await tabUntilFocused(page, t('classes.classForm.shiftLabel'), 20, { tag: 'BUTTON' });
      await selectByTypeahead(page, shiftOne);

      await tabUntilFocused(page, t('classes.classForm.save'), 20, { tag: 'BUTTON' });
      await page.keyboard.press('Enter');

      await expect(page.getByRole('link', { name: className })).toBeVisible();
    });

    await test.step('filter the class list by that shift', async () => {
      await page.evaluate(() => {
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });
      await page.keyboard.press('Tab');
      await tabUntilFocused(page, t('classes.list.shiftLabel'), 60, { tag: 'BUTTON' });
      await selectByTypeahead(page, shiftOne);

      await expect(page.getByRole('link', { name: className })).toBeVisible();
    });
  });
});
