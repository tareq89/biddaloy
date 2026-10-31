import { expect, loggedIn, test } from '../fixtures/test';
import { startVendorStub, VENDOR_STUB_URL, type VendorStub } from '../fixtures/vendor-stub';
import { makeT } from '../i18n';

/**
 * [#3304] Settings › Communication › SMS against a fake OneCodeSoft on 127.0.0.1: choose the
 * company, Test connection, Send a test message, Save, then the Message log row and Check status.
 * Every request is recorded by the stub, so a real company can never be reached (the server
 * accepts this loopback address only under the e2e-only seam, see 08-security Rule 7).
 * Serial: it changes the school's one SMS company, and the cleanup removes it again.
 */
test.describe.configure({ mode: 'serial' });
test.use({ ...loggedIn('admin'), e2eLocale: 'en' });

const t = makeT('en');
const phone = '01712345678';
let stub: VendorStub;

test.beforeAll(async () => {
  stub = await startVendorStub();
});
test.afterAll(async () => {
  await stub.close();
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
    await section.getByLabel('API address').fill(VENDOR_STUB_URL);
    await section.getByLabel('API key', { exact: false }).first().fill('stub-key');
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
    const row = page.getByRole('row').filter({ hasText: phone }).first();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: t('communications.messageLog.viewDetail') }).click();
    const dialog = page.getByRole('dialog');
    const check = dialog.getByRole('button', { name: t('communications.messageLog.checkStatus') });
    await check.click(); // the stub answers Pending the first time
    await expect(dialog.getByText(t('communications.messageLog.checkStatusDone'))).toBeVisible();
    await check.click();
    await expect(dialog.getByText('Delivered').first()).toBeVisible();
  });

  await test.step('cleanup: remove the saved company', async () => {
    await page.goto('/settings?section=communication');
    await section.getByRole('button', { name: t('settings.messaging.removeSaved') }).click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('settings.messaging.removeConfirmYes') })
      .click();
    await expect(section.getByText(t('settings.channelStatus.notReady'))).toBeVisible();
  });

  // Every call went to the stub (it is the only listener the guard lets through).
  expect(stub.requests.every((r) => r.path.startsWith('/v3/'))).toBe(true);
});
