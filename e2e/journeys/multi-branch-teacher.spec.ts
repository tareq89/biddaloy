import { createTeacher, loginAsFreshUser, post } from '../api';
import { shells } from '../config';
import { newSchool } from '../fixtures/new-school';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { SchoolPickerPage } from '../pages/school-picker';
import { escapeRegExp } from '../regex';

/**
 * [58.0.04] One person teaches in two branches. Branch B files a join request,
 * the teacher accepts, and only then does B show in their school switcher.
 * B then gives them their own teacher profile (same user, own employee id as
 * in A). Two schools of the spec's own.
 */
test.describe('same teacher in several branches', () => {
  test.setTimeout(120_000);

  test('join request, accept, own teacher profile in B', async ({
    browser,
    playwright,
  }) => {
    const branchA = await newSchool(browser, playwright);
    const branchB = await newSchool(browser, playwright);
    const teacher = await createTeacher(branchA.api, branchA.session, 'Rahim Shared');
    const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    const context = await browser.newContext({
      storageState: await loginAsFreshUser(api, shells.app.baseURL, teacher.email, teacher.password),
    });
    try {
      await test.step('B admin files a join request for the teacher', async () => {
        const { page } = branchB;
        await page.goto('/staff?new=1');
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel(t('staff.addUser.nameLabel')).fill('Rahim Shared');
        await dialog.getByLabel(t('staff.addUser.emailLabel')).fill(teacher.email);
        await dialog.getByLabel(t('staff.addUser.roleLabel')).click();
        await page.getByRole('option', { name: t('staff.roles.TEACHER') }).click();
        await dialog.getByRole('button', { name: t('staff.addUser.save') }).click();
        await dialog.getByRole('button', { name: t('staff.addUser.sendJoinRequest') }).click();
        await expect(page.getByText(t('staff.addUser.joinRequestSent'))).toBeVisible();
      });

      const page = await context.newPage();
      await test.step('before accepting, B is not in the switcher', async () => {
        await page.goto('/select-school');
        await expect(
          page.getByRole('radio', { name: new RegExp(escapeRegExp(branchB.schoolName)) }),
        ).toHaveCount(0);
      });

      await test.step('the teacher accepts; now both branches are listed', async () => {
        await page.goto('/dashboard');
        const card = page.getByRole('region', { name: t('nav.schoolInvites.title') });
        await card.getByRole('button', { name: t('nav.schoolInvites.accept') }).click();
        await expect(card).toHaveCount(0);
        await page.goto('/select-school');
        const picker = new SchoolPickerPage(page);
        await picker.expectLoaded();
        await expect(
          page.getByRole('radio', { name: new RegExp(escapeRegExp(branchB.schoolName)) }),
        ).toBeVisible();
        await picker.choose(branchB.schoolName);
        await expect(page).toHaveURL(/\/dashboard/);
      });

      await test.step('B gives them a separate teacher profile (own employee id)', async () => {
        const created = await post<{ id: string }>(branchB.api, branchB.session, '/teachers', {
          user_id: teacher.userId,
          employee_id: `SHARED-${crypto.randomUUID()}`,
        });
        expect(created.id).not.toBe(teacher.teacherId);
      });
    } finally {
      await context.close();
      await api.dispose();
      for (const s of [branchA, branchB]) {
        await s.context.close();
        await s.api.dispose();
      }
    }
  });
});
