import type { Page } from '@playwright/test';

import bnLegal from '../ui/src/i18n/locales/bn/legal.json';
import bnSupportBanner from '../ui/src/i18n/locales/bn/supportBanner.json';

import {
  createTeacher,
  createUnacceptedAdmin,
  loginAsFreshUser,
  uniqueRegistration,
} from './api';
import { shells } from './config';
import { newSchool, skipSetup } from './fixtures/new-school';
import { COCKPIT_URL, expect, guest, test } from './fixtures/test';
import { RegisterPage } from './pages';
import { ownerSession, startLoginAs } from './platform/support-helpers';

/**
 * [59.3.03, D29 D32 D33] The legal gate end to end, on schools of the spec's own.
 *
 * Fixture admins never stop at the gate (sign-up and `activateInvite` accept the current
 * versions); a second ADMIN made with `createUnacceptedAdmin` is the one the gate must stop.
 * The strings are the bn catalog (`legal.json`), the same ones `/legal/accept` shows.
 */
test.describe('legal acceptance', () => {
  test.setTimeout(120_000);

  /** A browser context signed in as `email`, on the page the spec gives back. */
  async function signedInPage(
    browser: Parameters<typeof newSchool>[0],
    playwright: Parameters<typeof newSchool>[1],
    email: string,
    password: string,
  ): Promise<{ page: Page; close: () => Promise<void> }> {
    const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    const context = await browser.newContext({
      storageState: await loginAsFreshUser(api, shells.app.baseURL, email, password),
    });
    return {
      page: await context.newPage(),
      close: async () => {
        await context.close();
        await api.dispose();
      },
    };
  }

  test('an admin who owes the documents is stopped, agrees, and reaches the app', async ({
    browser,
    playwright,
  }) => {
    const school = await newSchool(browser, playwright);
    const admin = await createUnacceptedAdmin(school.api, school.session, 'Legal Gate Admin');
    const signedIn = await signedInPage(browser, playwright, admin.email, admin.password);
    const { page } = signedIn;
    try {
      await page.goto('/students');
      await expect(page).toHaveURL(/\/legal\/accept/);
      // The page they were going to rides along in the URL.
      expect(decodeURIComponent(page.url())).toContain('/students');

      // Staff pages stay out of reach until the box is ticked and sent.
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/legal\/accept/);

      const submit = page.getByRole('button', { name: bnLegal.accept.submit });
      await expect(submit).toBeDisabled();
      await page.getByRole('checkbox', { name: bnLegal.accept.checkbox }).check();
      const accepted = page.waitForResponse(
        (res) => res.url().includes('/legal/accept') && res.request().method() === 'POST',
      );
      await submit.click();
      expect((await accepted).ok()).toBe(true);

      await expect(page).not.toHaveURL(/\/legal\/accept/);
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/\/(dashboard|welcome)/);
    } finally {
      await signedIn.close();
      await school.context.close();
      await school.api.dispose();
    }
  });

  test('a teacher is never stopped', async ({ browser, playwright }) => {
    const school = await newSchool(browser, playwright);
    const teacher = await createTeacher(school.api, school.session, 'Legal Gate Teacher');
    const signedIn = await signedInPage(browser, playwright, teacher.email, teacher.password);
    try {
      await signedIn.page.goto('/dashboard');
      await expect(signedIn.page).toHaveURL(/\/dashboard/);
      await expect(signedIn.page).not.toHaveURL(/\/legal\/accept/);
    } finally {
      await signedIn.close();
      await school.context.close();
      await school.api.dispose();
    }
  });

  test('a Login as visit is not stopped', async ({ browser, playwright }) => {
    // Two owner codes each wait for their own 30 s authenticator step.
    test.setTimeout(180_000);
    const school = await newSchool(browser, playwright);
    const owner = await playwright.request.newContext({ baseURL: COCKPIT_URL });
    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const admin = await createUnacceptedAdmin(school.api, school.session, 'Legal Support Admin');
      const session = await ownerSession(owner);
      const started = await startLoginAs(owner, session, {
        schoolId: school.session.tenantId,
        role: 'ADMIN',
        targetUserId: admin.id,
        reason: 'E2E legal gate check',
        viewOnly: false,
      });
      // A new school allows support access by default (first-login box is ticked).
      expect(started.code).toBeTruthy();

      const page = await visitor.newPage();
      await page.goto(`/support/enter#code=${started.code}`);
      await expect(
        page.getByRole('button', { name: bnSupportBanner.banner.end, exact: true }),
      ).toBeVisible({ timeout: 45_000 });
      await page.goto('/students');
      await expect(page).not.toHaveURL(/\/legal\/accept/);
    } finally {
      await visitor.close();
      await owner.dispose();
      await school.context.close();
      await school.api.dispose();
    }
  });

  test.describe('signed out', () => {
    test.use(guest);

    test('the terms open without signing in', async ({ page }) => {
      await page.goto('/legal/terms');
      await expect(page).toHaveURL(/\/legal\/terms/);
      await expect(page.getByRole('article')).toBeVisible();
    });

    test('sign-up: read the terms in the dialog, agree, and finish registering', async ({
      page,
    }) => {
      const who = uniqueRegistration();
      const register = new RegisterPage(page);
      await register.goto();

      const box = page.getByRole('checkbox', { name: new RegExp(bnLegal.docs.terms) });
      await expect(box).not.toBeChecked();
      await page.getByRole('button', { name: bnLegal.docs.terms, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: bnLegal.dialog.agree, exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(box).toBeChecked();

      const otp = await register.submitDetails({ ...who, address: '1 Test Road, Dhaka' });
      await register.submitCode(otp);
      await register.setPassword('Strong-Pass-1');
      // First stop is /welcome; the staff gate did not send them to /legal/accept.
      await skipSetup(page);
      await expect(page).not.toHaveURL(/\/legal\/accept/);
    });
  });
});
