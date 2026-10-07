import { adminApiSession, patch } from '../api';
import { loggedIn, expect, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [8.10.7.0-s3] Routines › Setup › Rules: the saved changeover gap and
 * teacher-day cap must still be there after a reload. Before the fix the
 * server threw the `routine` block away on PATCH, so a reload snapped the
 * fields back to 5 / empty.
 */

test.use(loggedIn('admin'));

test.afterEach(async ({ request }) => {
  // Put the shared seed tenant back to the default so other specs see 5 / no cap.
  const admin = await adminApiSession(request);
  await patch(request, admin, `/schools/${admin.tenantId}/settings`, {
    version: 1,
    routine: { defaultChangeoverMinutes: 5 },
  });
});

test('admin saves routine rules and they survive a reload, including a cleared cap', async ({
  page,
}) => {
  const changeover = () => page.getByLabel(t('routines.settingsPanel.defaultChangeoverMinutes'));
  const dailyCap = () => page.getByLabel(t('routines.settingsPanel.maxPeriodsPerTeacherPerDay'));
  const save = () => page.getByRole('button', { name: t('routines.save.action') });

  await page.goto('/routines/setup?tab=rules');
  await changeover().fill('10');
  await dailyCap().fill('5');
  await save().click();
  await expect(page.getByText(t('routines.save.success'))).toBeVisible();

  await page.reload();
  await expect(changeover()).toHaveValue('10');
  await expect(dailyCap()).toHaveValue('5');

  // Clearing a cap must stick too (the server stores `null`, not "keep the old value").
  await dailyCap().fill('');
  await save().click();
  await expect(page.getByText(t('routines.save.success'))).toBeVisible();

  await page.reload();
  await expect(changeover()).toHaveValue('10');
  await expect(dailyCap()).toHaveValue('');
});
