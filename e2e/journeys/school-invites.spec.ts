import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  PlaywrightWorkerArgs,
} from '@playwright/test';

import {
  activateInvite,
  addSchoolAdmin,
  E2E_PASSWORD,
  loginAsFreshUser,
  post,
  superAdminApiSession,
} from '../api';
import { shells } from '../config';
import { newSchool, type NewSchool } from '../fixtures/new-school';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { SchoolPickerPage } from '../pages/school-picker';

/**
 * [68.2.23] A person who already has an account is added to a second school.
 * The school files a join request; the person sees it as a card, then accepts
 * (and can use the school at once) or declines (nothing is created).
 *
 * Seed, all over the API: a teacher of school A (invite activated, so the
 * email is verified), and an unrelated school B. The platform admin adds the
 * teacher's email to B (`POST /schools/:id/admins`), which files the request.
 * Both schools are the spec's own: a join mutates membership.
 */
test.describe('school invitations', () => {
  test.setTimeout(120_000);

  async function seed(
    browser: Browser,
    playwright: PlaywrightWorkerArgs['playwright'],
    request: APIRequestContext,
  ) {
    const schoolA = await newSchool(browser, playwright);
    const schoolB = await newSchool(browser, playwright);
    const email = `invitee-${crypto.randomUUID()}@e2e.example.com`;
    const created = await post<{ user: { id: string }; invitation: { debug?: { token: string } } }>(
      schoolA.api,
      schoolA.session,
      '/users',
      { full_name: 'Invited Person', email, role: 'TEACHER', tenantId: schoolA.session.tenantId },
    );
    const token = created.invitation.debug?.token;
    if (!token) throw new Error('no invitation.debug.token — is ACCOUNT_ACCESS_ECHO_SECRETS=true?');
    await activateInvite(request, token, E2E_PASSWORD);
    const superAdmin = await superAdminApiSession(request);
    await addSchoolAdmin(request, superAdmin, schoolB.session.tenantId, 'Invited Person', email);
    return { schoolA, schoolB, email };
  }

  async function signIn(
    browser: Browser,
    playwright: PlaywrightWorkerArgs['playwright'],
    email: string,
  ): Promise<{ context: BrowserContext; page: Page; api: APIRequestContext }> {
    const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    const context = await browser.newContext({
      storageState: await loginAsFreshUser(api, shells.app.baseURL, email, E2E_PASSWORD),
    });
    return { context, page: await context.newPage(), api };
  }

  async function dispose(...schools: NewSchool[]) {
    for (const s of schools) {
      await s.context.close();
      await s.api.dispose();
    }
  }

  test('accept: the school appears in the picker and can be used', async ({
    browser,
    playwright,
    request,
  }) => {
    const { schoolA, schoolB, email } = await seed(browser, playwright, request);
    const person = await signIn(browser, playwright, email);
    try {
      const { page } = person;
      await test.step('the card shows school B', async () => {
        await page.goto('/dashboard');
        const card = page.getByRole('region', { name: t('nav.schoolInvites.title') });
        await expect(card.getByText(schoolB.schoolName)).toBeVisible();
        await card.getByRole('button', { name: t('nav.schoolInvites.accept') }).click();
        await expect(card).toHaveCount(0);
      });
      await test.step('the picker lists B and selecting it works', async () => {
        await page.goto('/select-school');
        const picker = new SchoolPickerPage(page);
        await picker.expectLoaded();
        await picker.choose(schoolB.schoolName);
        await expect(page).toHaveURL(/\/dashboard/);
      });
    } finally {
      await person.context.close();
      await person.api.dispose();
      await dispose(schoolA, schoolB);
    }
  });

  test('decline: the card goes and school B is not listed', async ({
    browser,
    playwright,
    request,
  }) => {
    const { schoolA, schoolB, email } = await seed(browser, playwright, request);
    const person = await signIn(browser, playwright, email);
    try {
      const { page } = person;
      await page.goto('/dashboard');
      const card = page.getByRole('region', { name: t('nav.schoolInvites.title') });
      await expect(card.getByText(schoolB.schoolName)).toBeVisible();
      await card.getByRole('button', { name: t('nav.schoolInvites.decline') }).click();
      await expect(card).toHaveCount(0);

      // Only school A remains: the person has a single membership, so no picker choice exists for B.
      await page.reload();
      await expect(page.getByText(schoolB.schoolName)).toHaveCount(0);
    } finally {
      await person.context.close();
      await person.api.dispose();
      await dispose(schoolA, schoolB);
    }
  });
});
