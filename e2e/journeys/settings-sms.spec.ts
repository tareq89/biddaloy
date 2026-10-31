import type { Page } from '@playwright/test';

import { expect, loggedIn, test } from '../fixtures/test';
import { startVendorStub, type VendorStub } from '../fixtures/vendor-stub';
import { makeT } from '../i18n';

/**
 * [#3304] Settings › Communication › SMS against a fake OneCodeSoft on 127.0.0.1: choose the
 * company, Test connection, Send a test message, Save, then the Message log row and Check status.
 * The server accepts this loopback address only under the e2e-only seam (08-security Rule 7).
 * Serial: it changes the school's one SMS company, and `afterEach` removes it again even when a
 * step fails, so a failure here cannot leave later specs pointed at a closed stub.
 */
test.describe.configure({ mode: 'serial' });
test.use({ ...loggedIn('admin'), e2eLocale: 'en' });

const t = makeT('en');
const phone = '01712345678';
// The Message log shows a number the way the region formats it.
const shownPhone = '01712-345678';
let stub: VendorStub;

test.beforeAll(async () => {
  stub = await startVendorStub();
});
test.afterAll(async () => {
  await stub.close();
});
/** Takes the saved SMS company off the school, if there is one (before and after: a failed run
 * must not leave later specs pointed at a closed stub). */
async function removeSavedSms(page: Page) {
  await page.goto('/settings?section=communication');
  const section = page.locator('#sms-section');
  await expect(section).toBeVisible();
  const remove = section.getByRole('button', { name: t('settings.messaging.removeSaved') });
  // The button appears once the saved settings have loaded.
  const saved = await remove
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!saved) return;
  await remove.click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: t('settings.messaging.removeConfirmYes') })
    .click();
  await expect(section.getByText(t('settings.channelStatus.notReady'))).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await removeSavedSms(page);
});
test.afterEach(async ({ page }) => {
  await removeSavedSms(page);
});

test('OneCodeSoft: test connection, test message, save, log row, check status', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const section = page.locator('#sms-section');

  await page.goto('/settings?section=communication');
  await expect(section).toBeVisible();

  await test.step('choose OneCodeSoft and fill the details', async () => {
    await section.getByRole('combobox', { name: t('settings.sms.provider') }).click();
    await page.getByRole('option', { name: 'OneCodeSoft' }).click();
    await section.getByLabel('Sender name').fill('E2ESchool');
    await section.getByLabel('API address').fill(stub.url);
    // A secret field shows no input until Add is pressed.
    await section
      .getByRole('button', { name: t('settings.secret.set') })
      .first()
      .click();
    await section.getByLabel('API key').first().fill('stub-key');
  });

  await test.step('a refused key shows our sentence and none of the vendor text', async () => {
    stub.failWith = 401;
    await section.getByRole('button', { name: t('settings.testConnection.action') }).click();
    await expect(section.getByText(t('settings.testConnection.failure'))).toBeVisible();
    await expect(page.getByText('Unauthenticated')).toHaveCount(0);
    stub.failWith = null;
  });

  await test.step('Test connection passes', async () => {
    await section.getByRole('button', { name: t('settings.testConnection.action') }).click();
    await expect(section.getByText(t('settings.testConnection.success'))).toBeVisible();
  });

  await test.step('Send a test message', async () => {
    await section.getByLabel(t('settings.sendTestMessage.phone')).fill(phone);
    await section.getByRole('button', { name: t('settings.sendTestMessage.label') }).click();
    await expect(section.getByText(t('settings.sendTestMessage.sent'))).toBeVisible();
    expect(stub.requests.some((r) => r.method === 'POST' && r.path === '/v3/send-sms')).toBe(true);
  });

  await test.step('Save shows the Set up pill', async () => {
    await section.getByRole('button', { name: t('settings.save.action') }).click();
    await expect(section.getByText(t('settings.channelStatus.ready'))).toBeVisible();
  });

  await test.step('the Message log has the Sent row; Check status reaches Delivered', async () => {
    await page.goto('/communications/message-log?search=Test');
    const row = page.getByRole('row').filter({ hasText: shownPhone }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: t('communications.messageLog.viewDetail') }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: t('communications.messageLog.checkStatus') }).click();
    // The toast lives outside the dialog (the app's Toaster), the status inside it.
    await expect(page.getByText(t('communications.messageLog.checkStatusDone'))).toBeVisible();
    await expect(dialog.getByText('Delivered').first()).toBeVisible();
  });
});
