import type { Page } from '@playwright/test';

import { endTrial, get, registerTrialSchool, superAdminApiSession } from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ListShellPage } from '../pages';

/**
 * [13.7.1] SUPER_ADMIN and trials: the schools list shows a school's trial, the
 * "Extend trial" dialog pushes it out, and a trial that ended (school suspended
 * by the daily job) becomes usable again after an extension.
 */
test.use({ ...loggedIn('super_admin'), actionTimeout: 15_000 });

async function extend(page: Page, days: number, reason: string): Promise<void> {
  await page.getByRole('button', { name: t('platform.trial.card.extendAction') }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(t('platform.trial.dialog.daysLabel')).fill(String(days));
  await dialog.getByLabel(t('platform.trial.dialog.reasonLabel')).fill(reason);
  await dialog.getByRole('button', { name: t('platform.trial.dialog.submit') }).click();
  await expect(page.getByText(t('platform.trial.dialog.success'))).toBeVisible();
}

test('the list shows a trial; extending it, even an ended one, works', async ({
  page,
  playwright,
}) => {
  test.setTimeout(90_000);
  // Its own request context: registering sets a refresh cookie, which must not
  // replace the super admin's.
  const registrar = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  let school;
  try {
    school = await registerTrialSchool(registrar);
  } finally {
    await registrar.dispose();
  }
  const schoolId = school.session.tenantId;
  // Scoped to the schools table: the backup-health table below it lists every school too.
  const row = page
    .getByRole('table', { name: t('platform.schools.tableCaption') })
    .getByRole('row')
    .filter({ hasText: school.schoolName });
  const list = new ListShellPage(page, {
    titleKey: 'platform.schools.title',
    searchLabelKey: 'platform.schools.searchLabel',
  });

  await test.step('the list shows the school as in trial', async () => {
    await page.goto('/schools');
    await list.expectLoaded();
    await list.search(school.schoolName);
    await expect(row).toBeVisible();
    await expect(row).not.toContainText(t('platform.trial.ended'));
  });

  await test.step('extend it from the school page', async () => {
    await page.goto(`/schools/${schoolId}`);
    await expect(page.getByRole('heading', { name: t('platform.trial.card.title') })).toBeVisible();
    await extend(page, 10, 'Asked for more time to import students');
  });

  await test.step('an ended trial shows as ended, then comes back after an extension', async () => {
    await endTrial(schoolId);
    await page.goto('/schools?trial=expired');
    await list.expectLoaded();
    await list.search(school.schoolName);
    await expect(row).toContainText(t('platform.trial.ended'));

    await page.goto(`/schools/${schoolId}`);
    await expect(page.getByText(t('platform.trial.card.endedOn'))).toBeVisible();
    await extend(page, 5, 'Reopened after the owner got in touch');

    const api = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    try {
      const schools = await get<{ id: string; status: string }[]>(
        api,
        await superAdminApiSession(api),
        '/schools',
      );
      expect(schools.find((s) => s.id === schoolId)?.status).toBe('ACTIVE');
    } finally {
      await api.dispose();
    }
    await page.goto('/schools?trial=expired');
    await list.expectLoaded();
    await list.search(school.schoolName);
    await expect(row).toHaveCount(0);
  });
});
