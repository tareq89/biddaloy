/**
 * [Epic 42] Template every tour clones: sign in, one screenshot with two callouts,
 * one GIF. Replaced by the real sign-in tour in 42.2.03. Shoot it by name
 * (`... playwright test -c playwright.docs.config.ts _example`).
 */
import { expect, test } from '@playwright/test';

import { beat, imgDir, loginAs, prepare, recordGif, shoot } from '../helpers/capture';

const dir = imgDir('_example');

test('example: dashboard shot with two callouts, then a GIF', async ({ browser, page }, info) => {
  const phone = info.project.metadata.device === 'phone';
  await prepare(page);
  await loginAs(page, 'admin');
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, `${dir}/example-01-dashboard${phone ? '-phone' : ''}.png`, [
    { target: page.getByRole('main') },
    { target: page.getByRole('navigation').first() },
  ]);

  const storageState = await page.context().storageState();
  const { userAgent, viewport, isMobile, hasTouch, deviceScaleFactor } = info.project.use;
  await recordGif(
    browser,
    {
      storageState,
      viewport: viewport ?? undefined,
      userAgent,
      isMobile,
      hasTouch,
      deviceScaleFactor,
    },
    `${dir}/example-take${phone ? '-phone' : ''}.gif`,
    async (p) => {
      await p.goto('/dashboard');
      await expect(p.getByRole('main')).toBeVisible();
      await beat(p, 1500);
    },
    { width: phone ? 390 : 960 },
  );
});
