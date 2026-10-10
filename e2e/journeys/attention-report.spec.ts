import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';

/**
 * [67.5.10] The alerts report over the seeded history (`ensureAttentionW5Seed`):
 * 40 alerts last month, 30 fixed, 10 of them `attendance.not_taken` spread
 * over the first sections. English UI; numbers may render in the school's own
 * digits, so every count is matched in both Latin and Bangla.
 */
const t = makeT('en');

/** `YYYY-MM` of the previous month in the seed's time zone (Asia/Dhaka). */
function lastMonth(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Matches `n` as Latin or Bangla digits. */
const num = (n: number) =>
  new RegExp(`^(${n}|${String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!)})$`);

const month = lastMonth();

test.describe('executive', () => {
  test.use({ ...loggedIn('executive'), e2eLocale: 'en' });

  test('last month shows the seeded totals, a section cell, and downloads the CSV', async ({
    page,
  }) => {
    await page.goto(`/reports/alerts?month=${month}`);
    await expect(page.getByRole('heading', { name: t('attention.report.title') })).toBeVisible();

    await test.step('facts', async () => {
      const total = page.getByText(t('attention.report.factTotal'), { exact: true }).locator('..');
      await expect(total.getByText(num(40))).toBeVisible();
      const fixed = page.getByText(t('attention.report.factFixed'), { exact: true }).locator('..');
      await expect(fixed.getByText(num(30))).toBeVisible();
    });

    await test.step('attendance not taken has a non-zero section cell', async () => {
      const row = page
        .getByRole('row')
        .filter({ hasText: t('attention.rules.attendance.not_taken.name') });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('cell', { name: num(10) }).first()).toBeVisible();
    });

    await test.step('CSV downloads under its month name', async () => {
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: t('attention.report.downloadCsv') }).click();
      expect((await download).suggestedFilename()).toBe(`alerts-report-${month}.csv`);
    });
  });
});

test.describe('teacher', () => {
  test.use({ ...loggedIn('teacher'), e2eLocale: 'en' });

  test('has no access to the report', async ({ page }) => {
    await page.goto('/reports/alerts');
    await expect(page.getByText(t('common.accessDenied.title'))).toBeVisible();
  });
});
