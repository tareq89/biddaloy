import { newSchool } from '../fixtures/new-school';
import { staffSheet, uniqueStaffRows } from '../fixtures/onboarding-files';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { StaffImportPage } from '../pages';

/**
 * [13.7.1] An admin imports staff from a file: one bad row is reported and
 * blocks the import, the fixed file goes through with invitations on, and the
 * new people show up in the Staff list. Own school: the import writes people.
 */
test('staff import: a problem row, then the clean file, then the list', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(90_000);
  const school = await newSchool(browser, playwright);
  try {
    const { page } = school;
    const rows = uniqueStaffRows();
    const importPage = new StaffImportPage(page);
    await importPage.goto();

    await test.step('a file with one bad role is reported, not importable', async () => {
      await importPage.upload(staffSheet(rows, true));
      await expect(page.getByText(t('staffImport.rowErrors.unknownRole'))).toBeVisible();
      await expect(importPage.confirmButton()).toBeDisabled();
    });

    await test.step('the clean file previews two people and imports with invitations', async () => {
      await page.getByRole('button', { name: t('bulkImport.uploadAnother') }).click();
      await importPage.upload(staffSheet(rows));
      await expect(page.getByText(t('staffImport.summary.willCreate', { count: 2 }))).toBeVisible();
      await importPage.setInvitations(true);
      await importPage.confirmButton().click();
      await expect(page.getByRole('heading', { name: t('staffImport.done.title') })).toBeVisible();
      await expect(page.getByText(t('staffImport.done.created', { count: 2 }))).toBeVisible();
      // The invitations themselves are not asserted: nothing in e2e can deliver them
      // (the page reports them under `done.inviteFailedRows`), but the import still counts.
    });

    await test.step('both are in the Staff list', async () => {
      await page.getByRole('link', { name: t('staffImport.done.seeStaff') }).click();
      await expect(page.getByText('Imported Teacher').first()).toBeVisible();
      await expect(page.getByText('Imported Accountant').first()).toBeVisible();
    });
  } finally {
    await school.context.close();
    await school.api.dispose();
  }
});
