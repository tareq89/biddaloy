import { post, registerTrialSchool } from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ListShellPage } from '../pages';

/**
 * Epic 49 W4: the platform SUPER_ADMIN's Subscriptions page. A school has a PENDING order of 40
 * seats; the super admin records the bank payment (the seats-bought tile moves from 0 to 40),
 * then grants 10 more seats (50). Revive is covered by the server e2e-spec and the dialog test:
 * an idle school cannot be made through the UI in a short run.
 */
test.use({ ...loggedIn('super_admin'), actionTimeout: 15_000 });

test('record an offline payment, then grant seats: the seats-bought tile follows', async ({
  page,
  playwright,
}) => {
  test.setTimeout(90_000);
  // Its own request context: registering sets a refresh cookie, which must not replace the
  // super admin's.
  const registrar = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  let school;
  try {
    school = await registerTrialSchool(registrar);
    await post(registrar, school.session, '/billing/orders', {
      seats: 40,
      months: 3,
      idempotency_key: `e2e-order-${crypto.randomUUID()}`,
    });
  } finally {
    await registrar.dispose();
  }

  const list = new ListShellPage(page, {
    titleKey: 'platform.subscriptions.title',
    searchLabelKey: 'platform.subscriptions.searchLabel',
  });
  const dialog = page.getByRole('dialog');
  const bought = dialog.getByTestId('tile-bought');

  await test.step('the school is listed with a pending order', async () => {
    await page.goto('/subscriptions');
    await list.expectLoaded();
    await list.search(school.schoolName);
    await page
      .getByRole('button', {
        name: t('platform.subscriptions.viewAction', { name: school.schoolName }),
      })
      .click();
    await expect(dialog).toBeVisible();
    await expect(bought).toContainText(/^[^0-9০-৯]*[0০][^0-9০-৯]*$/);
  });

  await test.step('recording the bank payment moves the seats bought to 40', async () => {
    await dialog
      .getByRole('button', { name: t('platform.subscriptions.panel.recordPayment') })
      .click();
    const payment = page.getByRole('dialog', { name: t('platform.subscriptions.payment.title') });
    await payment
      .getByLabel(t('platform.subscriptions.payment.referenceLabel'))
      .fill(`SLIP-${Date.now()}`);
    await payment.getByRole('button', { name: t('platform.subscriptions.payment.submit') }).click();
    await expect(page.getByText(t('platform.subscriptions.payment.success'))).toBeVisible();
    await expect(bought).toContainText(/40|৪০/);
  });

  await test.step('granting 10 seats moves it to 50', async () => {
    await dialog
      .getByRole('button', { name: t('platform.subscriptions.panel.grantSeats') })
      .click();
    const grant = page.getByRole('dialog', { name: t('platform.subscriptions.grant.title') });
    await grant.getByLabel(t('platform.subscriptions.grant.seatsLabel')).fill('10');
    await grant.getByLabel(t('platform.subscriptions.grant.monthsLabel')).fill('1');
    await grant
      .getByLabel(t('platform.subscriptions.grant.reasonLabel'))
      .fill('Pilot extension agreed with the owner');
    await grant.getByRole('button', { name: t('platform.subscriptions.grant.submit') }).click();
    await expect(page.getByText(t('platform.subscriptions.grant.success'))).toBeVisible();
    await expect(bought).toContainText(/50|৫০/);
  });
});
