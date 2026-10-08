import { loggedIn, expect, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [21.11.1] / [66.3.01] Epic close journey: a teacher's "My routine" (today's
 * periods to report) and a guardian's portal routine. Local e2e runs in `bn`
 * locale (see this repo's Playwright config), so every assertion below is on
 * an ARIA role or a translation key resolved through `t()`, never raw English.
 *
 * **Known gap, flagged rather than hidden**: the seeded periods are dated by
 * weekday and the lesson plans depend on the seed, so which cards exist
 * depends on the day this runs. The spec asserts the page shape, and marks
 * taught only when a period with a plan is open.
 */

test.describe('teacher: My routine, phone viewport', () => {
  test.use({ ...loggedIn('teacher'), viewport: { width: 390, height: 844 } });

  test('shows today’s summary and either period cards or the empty-day message', async ({
    page,
  }) => {
    await page.goto('/routines/my');

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 2 }).first()).toBeVisible();
    const periodCard = main.getByRole('article').first();
    const emptyDay = main.getByText(t('routines.agenda.emptyDay'));
    await expect(periodCard.or(emptyDay).first()).toBeVisible();
  });

  test('marking a period taught persists after a reload', async ({ page }) => {
    await page.goto('/routines/my');

    const taught = page.getByRole('radio', { name: t('routines.marking.status.taught') }).first();
    // No open planned period today: nothing to mark (see the file docblock).
    test.skip(!(await taught.isVisible().catch(() => false)), 'no open planned period today');

    await taught.click();
    await expect(taught).toBeChecked();
    await page.reload();
    await expect(
      page.getByRole('radio', { name: t('routines.marking.status.taught') }).first(),
    ).toBeChecked();
  });
});

test.describe('guardian: portal routine, phone viewport', () => {
  test.use({ ...loggedIn('parent'), viewport: { width: 390, height: 844 } });

  test('shows the linked child’s routine with a day switcher', async ({ page }) => {
    await page.goto('/portal/routine');

    // A guardian with no active enrolment for their child at all shows
    // an empty state instead of a switcher — both are legitimate given
    // this spec runs against whichever seeded child the shared
    // `parent@biddaloy.test` account happens to be linked to.
    const daySwitcher = page.getByRole('tablist', { name: t('routines.agenda.daySwitcherLabel') });
    const emptyState = page.getByText(t('portal.routine.noRoutineExplanation'));
    await expect(daySwitcher.or(emptyState)).toBeVisible();
  });
});
