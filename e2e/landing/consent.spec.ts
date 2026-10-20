import { expect, test } from '@playwright/test';

const THIRD_PARTY = /clarity\.ms|connect\.facebook\.net|aipraktor\.com/;

test('nothing third-party loads before the visitor chooses, and "no" keeps it that way', async ({
  page,
}) => {
  const hits: string[] = [];
  page.on('request', (r) => THIRD_PARTY.test(r.url()) && hits.push(r.url()));
  await page.goto('/en/');
  await expect(page.locator('#consent')).toBeVisible();
  await page.locator('#cNo').click();
  await expect(page.locator('#consent')).toBeHidden();
  await page.waitForTimeout(500);
  expect(hits).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('sm:consent'))).toBe(
    '{"stat":0,"ads":0,"chat":0}',
  );
  await page.reload();
  await expect(page.locator('#consent')).toBeHidden(); // remembered
});

test('the footer link reopens the bar', async ({ page }) => {
  await page.goto('/en/');
  await page.locator('#cNo').click();
  await page.locator('#cookieAgain').click();
  await expect(page.locator('#consent')).toBeVisible();
});
