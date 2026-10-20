import bn from '../ui/src/i18n/locales/bn/billing.json' with { type: 'json' };

import { expect, loggedIn, test } from './fixtures/test';

/**
 * [49.10 #1825] Settings > Seats & billing: an ADMIN opens the section, starts a purchase and the
 * PENDING order shows in the table. The pay step is a later ticket, so nothing is paid here.
 * (The e2e DB uses the dev seed, not the demo seed, so the orders table may start empty.)
 */
test.use(loggedIn('admin'));

test('admin buys seats and sees the pending order', async ({ page }) => {
  await page.goto('/settings?section=billing');

  await expect(page.getByRole('heading', { name: bn.title, level: 2 })).toBeVisible();
  await expect(page.getByText(bn.tiles.bought)).toBeVisible();

  await page.getByRole('button', { name: bn.buy.action }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog.getByLabel(bn.buy.seats).fill('150');
  await dialog.getByLabel(bn.buy.months).fill('2');
  await dialog.getByRole('button', { name: bn.buy.submit }).click();

  await expect(dialog.getByText(bn.buy.createdTitle)).toBeVisible();
  await dialog.getByRole('button', { name: bn.buy.close }).click();

  const orders = page.getByRole('table', { name: bn.orders.caption });
  await expect(orders.getByText(bn.orders.statusValue.PENDING).first()).toBeVisible();
});
