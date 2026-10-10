import { adminApiSession, del, get } from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';

/**
 * [67.5.10] A manual alert end to end: the admin sends one to a single
 * teacher, the teacher finds it in the to-do list, the admin withdraws it and
 * the teacher sees it move to History as expired. English UI. The audience is
 * one named user so no other spec's alert counts change.
 */
const t = makeT('en');
const title = `E2E alert ${Date.now()}`;
const message = 'Bring your attendance register to the staff room.';

test.describe.configure({ mode: 'serial' });

test.afterAll(async ({ playwright }) => {
  // Leave the seed clean (the daily cap is 20): withdraw whatever this run left active.
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

test.describe('admin sends', () => {
  test.use({ ...loggedIn('admin'), e2eLocale: 'en' });

  test('picks one teacher, sees 1 recipient, sends', async ({ page }) => {
    await page.goto('/communications/send-alert');
    await expect(page.getByRole('heading', { name: t('attention.composer.title') })).toBeVisible();

    await page.getByLabel(t('attention.composer.titleLabel'), { exact: true }).fill(title);
    await page.getByLabel(t('attention.composer.messageLabel'), { exact: true }).fill(message);

    await page.getByRole('checkbox', { name: t('attention.composer.namedPeople') }).click();
    await page.getByRole('combobox', { name: t('attention.composer.findPerson') }).click();
    await page.keyboard.type('Teacher User');
    // The list re-renders while the staff list loads, so skip the "stable" wait.
    await page.getByRole('option', { name: /^Teacher User/ }).click({ force: true });
    await expect(page.getByText(/^(1|১) person in total$/)).toBeVisible();

    await page.getByRole('button', { name: t('attention.composer.send'), exact: true }).click();
    await expect(page.getByText(/^Sent to (1|১) person$/)).toBeVisible();
    await expect(page).not.toHaveURL(/send-alert/);
  });
});

test.describe('teacher receives', () => {
  test.use({ ...loggedIn('teacher'), e2eLocale: 'en' });

  test('the alert is in To-do', async ({ page }) => {
    await page.goto('/notifications?tab=active');
    await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(1);
  });
});

test.describe('admin withdraws', () => {
  test.use({ ...loggedIn('admin'), e2eLocale: 'en' });

  test('Withdraw asks first, then the alert shows as withdrawn', async ({ page }) => {
    await page.goto('/communications/send-alert');
    const row = page.getByRole('row').filter({ hasText: title });
    await row.getByRole('button', { name: /Withdraw/ }).click();
    await page
      .getByRole('alertdialog', { name: t('attention.composer.withdrawTitle') })
      .getByRole('button', { name: t('attention.composer.withdraw'), exact: true })
      .click();
    await expect(page.getByText(t('attention.composer.withdrawn'))).toBeVisible();
    await expect(row).toContainText(t('attention.composer.statusWITHDRAWN'));
  });
});

test.describe('teacher after withdrawal', () => {
  test.use({ ...loggedIn('teacher'), e2eLocale: 'en' });

  test('gone from To-do, present in History as expired', async ({ page }) => {
    await page.goto('/notifications?tab=active');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);

    await page.goto('/notifications?tab=history');
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: title })
        .filter({ hasText: t('attention.state.EXPIRED') }),
    ).toHaveCount(1);
  });
});
