/**
 * [Epic 42] Media for the guide's welcome page (`README.md`).
 * Shoots the dashboards of the demo school: admin and teacher on desktop,
 * teacher and guardian on a phone.
 */
import { expect, test } from '@playwright/test';

import { imgDir, loginAs, prepare, shoot } from '../helpers/capture';

const dir = imgDir('welcome');

test('desktop: admin dashboard', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'admin');
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, `${dir}/welcome-01-dashboard-admin.png`);
});

test('desktop: teacher dashboard', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, `${dir}/welcome-02-dashboard-teacher.png`);
});

test('phone: teacher dashboard', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  await prepare(page);
  await loginAs(page, 'class-teacher-8a');
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, `${dir}/welcome-phone-01-teacher.png`);
});

test('phone: guardian portal', async ({ page }, info) => {
  test.skip(info.project.metadata.device !== 'phone');
  await prepare(page);
  // loginAs expects /dashboard; a guardian lands on /portal.
  await page.goto('/login?role=guardian');
  await page.waitForURL(/\/(portal|select-school)/);
  if (page.url().includes('/select-school')) {
    await page.getByRole('button', { name: /Continue|চালিয়ে যান/ }).click();
  }
  await expect(page).toHaveURL(/\/portal/);
  await expect(page.getByRole('main')).toBeVisible();
  await shoot(page, `${dir}/welcome-phone-02-guardian.png`);
});
