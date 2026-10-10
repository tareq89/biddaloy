import { adminApiSession, del, get } from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [67.5.10] "Send an alert", KEYBOARD ONLY: reach the composer from the
 * sidebar, fill every field with Tab/Space/typing, Esc on a dirty form asks
 * before discarding, Ctrl+Enter sends. One named teacher so no one else's bar
 * changes. No `.click(` and no `page.mouse` in this file.
 */
const t = makeT('en');
const title = `E2E keyboard alert ${Date.now()}`;

test.use({ ...loggedIn('admin'), e2eLocale: 'en', actionTimeout: 15_000 });

test.afterAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: shells.app.baseURL });
  try {
    const session = await adminApiSession(ctx);
    const list = await get<{ items: { id: string; title: string; status: string }[] }>(
      ctx,
      session,
      '/attention/manual?page=1&pageSize=50',
    );
    for (const a of list.items) {
      if (a.title === title && a.status === 'ACTIVE') {
        await del(ctx, session, `/attention/manual/${a.id}`);
      }
    }
  } finally {
    await ctx.dispose();
  }
});

test('open from the sidebar, fill by keyboard, Esc asks, Ctrl+Enter sends', async ({ page }) => {
  test.setTimeout(90_000);
  await test.step('reach the composer from the sidebar', async () => {
    // Not openFromSidebar: the composer is a full-page dialog and focus lands on its
    // Close button, not on the h1 that helper waits for.
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await tabUntilFocused(page, t('nav.items.sendAlert'), 150, { tag: 'a', exact: true });
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: t('attention.composer.title') });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(inside).toBe(true); // focus is trapped in the composer, not behind it
  });

  await tabUntilFocused(page, t('attention.composer.titleLabel'), 30);
  await page.keyboard.type(title);
  await tabUntilFocused(page, t('attention.composer.messageLabel'), 5);
  await page.keyboard.type('Keyboard-only alert.');

  await test.step('named person by keyboard', async () => {
    await tabUntilFocused(page, t('attention.composer.namedPeople'), 30);
    await page.keyboard.press('Space');
    await tabUntilFocused(page, t('attention.composer.findPerson'), 5);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Teacher User');
    await expect(page.getByRole('option', { name: /^Teacher User/ })).toBeVisible();
    // The filter also matches "Assistant Teacher User": ArrowDown to the exact one.
    const active = page.locator('[role="option"][data-active="true"]');
    for (let i = 0; i < 5 && !/^Teacher User/.test((await active.textContent()) ?? ''); i += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await expect(active).toHaveText(/^Teacher User/);
    await page.keyboard.press('Enter');
    await expect(page.getByText(/^(1|১) person in total$/)).toBeVisible();
  });

  await test.step('Esc on a dirty form asks before discarding, and Keep editing stays', async () => {
    await page.keyboard.press('Escape');
    // The full-page shell asks (its own dialog) before closing a dirty form.
    const ask = page.getByRole('alertdialog', { name: t('common.fullPage.discardTitle') });
    await expect(ask).toBeVisible();
    await page.keyboard.press('Escape'); // closes the question, not the page
    await expect(ask).toBeHidden();
    await expect(page.getByLabel(t('attention.composer.titleLabel'), { exact: true })).toHaveValue(
      title,
    );
  });

  await test.step('Ctrl+Enter sends', async () => {
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText(/^Sent to (1|১) person$/)).toBeVisible();
    await expect(page).not.toHaveURL(/send-alert/);
  });
});
