import { adminApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

// [TIME-11] An admin turns on "text guardians when homework is assigned" in
// School settings > Academics, saves, reloads, and still sees it ticked.
test.describe('homework notice settings', () => {
  test.use(loggedIn('admin'));

  test('the assign notice switch is off by default and survives a reload', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const settingsUrl = `/api/v1/schools/${admin.tenantId}/settings`;
    const headers = { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId };
    const reset = () =>
      request.patch(settingsUrl, {
        headers,
        data: { version: 1, homework: { notifyOnAssign: false, notifyDefaulters: false } },
      });

    // Start from off, whatever an earlier run left behind.
    expect((await reset()).ok()).toBe(true);
    try {
      await page.goto('/settings?section=academics');
      const card = page.locator('#homework-section');
      await expect(card).toBeVisible();
      const box = card.getByLabel(t('settings.homework.notifyOnAssign'));
      await expect(box).not.toBeChecked();

      await box.check();
      await card.getByRole('button', { name: t('settings.save.action') }).click();
      await expect(card.getByText(t('settings.save.success'))).toBeVisible();

      await page.reload();
      await expect(
        page.locator('#homework-section').getByLabel(t('settings.homework.notifyOnAssign')),
      ).toBeChecked();
      await expect(
        page.locator('#homework-section').getByLabel(t('settings.homework.notifyDefaulters')),
      ).not.toBeChecked();
    } finally {
      await reset();
    }
  });
});
