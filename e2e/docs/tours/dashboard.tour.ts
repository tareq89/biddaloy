/**
 * [Epic 42 / #2532] Media for the Dashboard guide pages (`dashboard`).
 * One desktop shot per role, the teacher on a phone, the customise mode (shot and
 * GIF) and the settings section with the at-risk limits. Demo-school logins only.
 * Capture is broken today ("Invalid hook call"); this tour is written against the
 * app's own i18n words so it is ready when capture is fixed.
 */
import { expect, test } from '@playwright/test';

import bnDashboard from '../../../ui/src/i18n/locales/bn/dashboard.json';
import bnSettings from '../../../ui/src/i18n/locales/bn/settings.json';
import enDashboard from '../../../ui/src/i18n/locales/en/dashboard.json';
import enSettings from '../../../ui/src/i18n/locales/en/settings.json';
import { beat, guideLang, imgDir, loginAs, prepare, recordGif, shoot } from '../helpers/capture';

const lang = guideLang();
const t = lang === 'bn' ? bnDashboard : enDashboard;
const settings = lang === 'bn' ? bnSettings : enSettings;
const dir = imgDir('dashboard');
const roles = [
  ['admin', 'admin'],
  ['teacher', 'class-teacher-8a'],
  ['accountant', 'accountant'],
  ['committee', 'committee'],
  ['office', 'office-staff'],
  ['exam', 'exam-controller'],
] as const;

for (const [name, card] of roles) {
  test(`desktop: ${name} dashboard`, async ({ page }, info) => {
    test.skip(info.project.metadata.device !== 'desktop');
    await prepare(page);
    await loginAs(page, card);
    await expect(page.getByRole('main')).toBeVisible();
    await shoot(page, `${dir}/dashboard-01-${name}.png`);
  });
}

test('phone: teacher dashboard', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, `${dir}/dashboard-phone-01-teacher.png`);
});

test('customise mode: shot and GIF', async ({ browser, page }, info) => {
  const phone = info.project.metadata.device === 'phone';
  await prepare(page);
  await loginAs(page, 'admin');
  const customise = page.getByRole('button', { name: t.page.customiseAria });
  await customise.click();
  await expect(page.getByText(t.customise.badge)).toBeVisible();
  await shoot(page, `${dir}/dashboard-02-customise${phone ? '-phone' : ''}.png`);

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
    `${dir}/dashboard-customise${phone ? '-phone' : ''}.gif`,
    async (p) => {
      await p.goto('/dashboard?customize=1');
      await expect(p.getByText(t.customise.badge)).toBeVisible();
      await beat(p, 1200);
      await p.getByRole('button', { name: t.customise.reset }).click();
      await beat(p, 1200);
      await p.getByRole('button', { name: t.customise.cancel }).click();
      await beat(p, 800);
    },
    { width: phone ? 390 : 960 },
  );
});

test('settings: Dashboard section with the at-risk limits', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'admin');
  await page.goto('/settings');
  const legend = page.getByText(settings.dashboard.legend, { exact: true }).first();
  await legend.scrollIntoViewIfNeeded();
  await expect(legend).toBeVisible();
  await shoot(page, `${dir}/dashboard-03-settings.png`, [{ target: legend }]);
});
