/**
 * [Epic 42 / W8] Screenshots for the Administration guide pages
 * (`docs/user-guide/{bn,en}/administration`). Demo school, nothing is saved.
 */
import { test, type Page } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step } from '../helpers/nav';

const dir = imgDir('administration');
const f = (name: string) => `${dir}/${name}.png`;
const h1 = (p: Page) => p.getByRole('main').getByRole('heading', { level: 1 });
const SECTIONS = ['school', 'academics', 'finance', 'billing', 'communication', 'printing', 'security', 'alerts', 'backup'];

async function settle(page: Page, ms = 1500) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(ms);
}

test.describe.configure({ mode: 'serial' });

test('administration pages', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  const main = page.getByRole('main');

  await step('audit', async () => {
    await go(page, '/audit-logs');
    await settle(page, 2500);
    const row = main.locator('tbody tr').first();
    await snap(page, f('audit-logs-01-list'), [
      { target: h1(page) },
      { target: main.getByRole('combobox').first() },
      { target: row },
    ]);
  });

  await step('roles', async () => {
    await go(page, '/roles');
    await settle(page, 2000);
    await snap(page, f('roles-01-list'), [{ target: h1(page) }, { target: main.locator('div.rounded-lg.border').first() }]);
  });

  await step('print-templates', async () => {
    await go(page, '/print-templates');
    await settle(page, 2000);
    await snap(page, f('print-templates-01-list'), [{ target: h1(page) }]);
  });

  await step('curriculum', async () => {
    await go(page, '/curriculum-preset');
    await settle(page, 2000);
    await snap(page, f('curriculum-preset-01'), [{ target: h1(page) }]);
  });

  for (const s of SECTIONS) {
    await step(`settings-${s}`, async () => {
      await go(page, `/settings?section=${s}`);
      await settle(page, 2500);
      await snap(page, f(`settings-${s}`), [{ target: h1(page) }, { target: main.getByRole('heading').nth(1) }]);
    });
  }
});
