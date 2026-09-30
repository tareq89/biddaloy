import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { SEED_LIFECYCLE_STUDENTS, SEED_TRANSFER_DESTINATION } from '../seed-contract';

import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [39.4.3] Keyboard-only journey for the People › Admissions › Admission reports screen:
 * Tab to its sidebar link, open it, pick the academic year in the filter, and read the
 * seeded lifecycle events (`ensureStudentLifecycleSeed`, 39.1.4).
 *
 * The seed puts these events in the demo year "2026-2027":
 *   0001 WITHDRAWN then READMITTED, 0002 TRANSFERRED_OUT, 0003 GRADUATED
 * so the tiles read Left 2 (withdrawn + transferred out), Graduated 1, Readmitted 1.
 * The next year ("2027-2028") has no events, so it must show the empty state.
 *
 * Reaching the sidebar link by Tab is the point of this spec (nav reachability), so it tabs
 * through the sidebar, unlike the specs that start from the skip link. The cap is generous on
 * purpose: the press count grows with every nav item, and a tight cap turns each new sidebar
 * link into a failure somewhere else (class-teachers.spec hit exactly that).
 */

test.use(loggedIn('admin'));

const TABS_TO_NAV_LINK_MAX = 150;

test('keyboard-only: open the admission report, pick a year, read the lifecycle counts', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('nav -> Admission reports, keyboard only', async () => {
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await tabUntilFocused(page, t('nav.items.admissionReports'), TABS_TO_NAV_LINK_MAX, {
      tag: 'a',
    });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 1, name: t('admission-reports.title') }),
    ).toBeVisible();
  });

  const counts = page.getByTestId('lifecycle-counts');
  const tile = (label: string) =>
    counts.locator('div', { has: page.getByText(label, { exact: true }) });

  await test.step('pick the demo year by keyboard and read the seeded counts', async () => {
    const year = page.getByRole('combobox', { name: t('admission-reports.filterYear') });
    await year.focus();
    await selectByTypeahead(page, '2026-2027');

    await expect(counts).toBeVisible();
    await expect(tile(t('admission-reports.countLeft'))).toContainText('2');
    await expect(tile(t('admission-reports.countGraduated'))).toContainText('1');
    await expect(tile(t('admission-reports.countReadmitted'))).toContainText('1');

    // The event table lists the seeded students and the transfer destination.
    const table = page.getByRole('table', { name: t('admission-reports.caption') });
    await expect(table.getByText(SEED_LIFECYCLE_STUDENTS.transferredOut)).toBeVisible();
    await expect(table.getByText(SEED_LIFECYCLE_STUDENTS.graduated)).toBeVisible();
    await expect(table.getByText(SEED_TRANSFER_DESTINATION)).toBeVisible();
  });

  await test.step('a year with no events shows the empty state, not stale rows', async () => {
    const year = page.getByRole('combobox', { name: t('admission-reports.filterYear') });
    await year.focus();
    await selectByTypeahead(page, '2027-2028');

    await expect(page.getByText(t('admission-reports.emptyMessage'))).toBeVisible();
    await expect(page.getByText(SEED_LIFECYCLE_STUDENTS.graduated)).toHaveCount(0);
  });
});
