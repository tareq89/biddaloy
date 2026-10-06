import { createTeacher, loginAsFreshUser } from '../api';
import { shells } from '../config';
import { newSchool } from '../fixtures/new-school';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { ListShellPage } from '../pages';

/**
 * [13.7.1] A teacher leaves the school from `/security`; the admin finds them
 * under "Former" and brings them back. The only admin cannot leave. Own school
 * (a leave removes the membership; the seeded ones are shared).
 */
test.describe('leave a school', () => {
  test.setTimeout(90_000);

  test('a teacher leaves, the admin brings them back', async ({ browser, playwright }) => {
    const school = await newSchool(browser, playwright);
    const teacherApi = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    try {
      const teacher = await createTeacher(school.api, school.session, 'Leaving Teacher');
      const teacherContext = await browser.newContext({
        storageState: await loginAsFreshUser(
          teacherApi,
          shells.app.baseURL,
          teacher.email,
          teacher.password,
        ),
      });
      const teacherPage = await teacherContext.newPage();

      await test.step('the teacher leaves and is signed out', async () => {
        await teacherPage.goto('/security');
        await teacherPage.getByRole('button', { name: t('signInMethods.leave.title') }).click();
        await teacherPage
          .getByRole('alertdialog')
          .getByRole('button', { name: t('signInMethods.leave.confirm') })
          .click();
        await expect(teacherPage).toHaveURL(/\/login/);
      });
      await teacherContext.close();

      const { page } = school;
      const list = new ListShellPage(page, { titleKey: 'staff.list.title' });
      await test.step('the admin finds them under Former', async () => {
        await page.goto('/staff?membership=former');
        await list.expectLoaded();
        await expect(list.row('Leaving Teacher')).toBeVisible();
      });

      await test.step('and brings them back', async () => {
        await list.clickRowAction('Leaving Teacher', 'staff.former.bringBack');
        await page
          .getByRole('dialog')
          .getByRole('button', { name: t('staff.former.bringBack') })
          .click();
        await expect(list.row('Leaving Teacher')).toHaveCount(0);
        await page.goto('/staff');
        await list.expectLoaded();
        await expect(list.row('Leaving Teacher')).toBeVisible();
      });
    } finally {
      await teacherApi.dispose();
      await school.context.close();
      await school.api.dispose();
    }
  });

  test('the only admin cannot leave', async ({ browser, playwright }) => {
    const school = await newSchool(browser, playwright);
    try {
      const { page } = school;
      await page.goto('/security');
      await page.getByRole('button', { name: t('signInMethods.leave.title') }).click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: t('signInMethods.leave.confirm') })
        .click();
      await expect(
        page.getByRole('alertdialog').getByText(t('signInMethods.leave.lastAdmin')),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/security/);
    } finally {
      await school.context.close();
      await school.api.dispose();
    }
  });
});
