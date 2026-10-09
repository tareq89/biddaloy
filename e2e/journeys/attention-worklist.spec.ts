import { extendTrial, raiseTrialEnding } from '../api';
import { shells } from '../config';
import { newSchool, skipSetup } from '../fixtures/new-school';
import { expect, guest, test } from '../fixtures/test';
import { makeT } from '../i18n';

/**
 * [67.2.10] The attention worklist against the real engine: a trial that is 6
 * days from its end raises a WARNING, hiding it keeps it in To-do ("Closed for
 * now", bar gone, D19), and extending the trial resolves it into History.
 * English UI, so the bar counts read "1 warning".
 */
const t = makeT('en');
test.use(guest);

test('trial ending: raised, closed for now, then fixed and moved to History', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const school = await newSchool(browser, playwright);
  const { page } = school;
  try {
    await skipSetup(page);
    await page.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));
    const bar = page
      .getByRole('status')
      .filter({ hasText: t('attention.bar.warning_one', { n: 1 }) });

    await test.step('6 days left raises a warning in the bar', async () => {
      await raiseTrialEnding(playwright, school.session.tenantId, shells.app.baseURL);
      // The recheck runs about 5 s after the trial change.
      await expect
        .poll(
          async () => {
            await page.goto('/dashboard');
            return bar.waitFor({ timeout: 3_000 }).then(
              () => 1,
              () => 0,
            );
          },
          { timeout: 30_000, intervals: [2_000] },
        )
        .toBeGreaterThan(0);
    });

    await test.step('To-do lists it as Open; closing keeps it as "Closed for now"', async () => {
      await page.goto('/notifications?tab=active');
      await expect(
        page.getByRole('row').filter({ hasText: t('attention.state.OPEN') }),
      ).toHaveCount(1);
      await page.getByRole('button', { name: /^Close: / }).click();
      await expect(
        page.getByRole('row').filter({ hasText: t('attention.state.HIDDEN') }),
      ).toHaveCount(1);
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(bar).toHaveCount(0);
      await page.goto('/notifications?tab=active');
      await expect(
        page.getByRole('tab', { name: t('attention.worklist.tabActive', { n: 1 }) }),
      ).toBeVisible();
    });

    await test.step('60 more days resolve it: History says Fixed, To-do is empty', async () => {
      const superAdmin = await playwright.request.newContext({ baseURL: shells.app.baseURL });
      try {
        await extendTrial(superAdmin, school.session.tenantId, 60, 'e2e trial resolved');
      } finally {
        await superAdmin.dispose();
      }
      await expect
        .poll(
          async () => {
            await page.goto('/notifications?tab=history');
            return page
              .getByRole('row')
              .filter({ hasText: 'Fixed' })
              .first()
              .waitFor({ timeout: 3_000 })
              .then(
                () => 1,
                () => 0,
              );
          },
          { timeout: 30_000, intervals: [2_000] },
        )
        .toBeGreaterThan(0);
      await page.goto('/notifications?tab=active');
      await expect(
        page.getByRole('heading', { name: t('attention.worklist.emptyActiveTitle') }),
      ).toBeVisible();
    });
  } finally {
    await school.context.close();
    await school.api.dispose();
  }
});
