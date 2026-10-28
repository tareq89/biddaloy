/**
 * [Epic 42 / #2532] Media for the "Alerts & notifications" guide page
 * (`dashboard.alerts`, route /notifications): the To-do and History tabs on desktop
 * and on a phone (teachers read alerts on the phone). Demo-school logins only.
 */
import { expect, test } from '@playwright/test';

import bnAttention from '../../../ui/src/i18n/locales/bn/attention.json';
import enAttention from '../../../ui/src/i18n/locales/en/attention.json';
import { guideLang, imgDir, loginAs, prepare, shoot } from '../helpers/capture';

const lang = guideLang();
const a = lang === 'bn' ? bnAttention : enAttention;
const dir = imgDir('dashboard');

test('alerts: To-do and History', async ({ page }, info) => {
  const phone = info.project.metadata.device === 'phone';
  const suffix = phone ? '-phone' : '';
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: a.worklist.title })).toBeVisible();
  await shoot(page, `${dir}/dashboard-alerts-01-todo${suffix}.png`);
  await page.getByRole('tab', { name: a.worklist.tabHistory }).click();
  await shoot(page, `${dir}/dashboard-alerts-02-history${suffix}.png`);
});
