/**
 * [Epic 42 / W11] Communications shots. Demo school.
 */
import { test } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('communications');
const f = (name: string) => `${dir}/${name}.png`;

test('comms W11: send alert', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  await step('alert-form', async () => {
    await go(page, '/communications/send-alert');
    await page.waitForTimeout(2500);
    await page.setViewportSize({ width: 1440, height: 2100 });
    await page.getByRole('textbox').first().fill('Annual sports day moved to Saturday');
    await page
      .getByRole('textbox')
      .nth(1)
      .fill('Because of the weather the sports day is now on Saturday, 9 am.');
    await page
      .getByRole('checkbox', { name: tr('attention', 'composer.guardiansOfSections') })
      .check();
    await page.waitForTimeout(800);
    await page.getByRole('combobox').nth(1).click();
    await page.keyboard.type('8');
    await page.waitForTimeout(1500);
    await page.getByRole('option').first().click();
    await page.waitForTimeout(2500);
    await snap(page, f('send-alert-02-filled'), []);
    const card = (id: string) => page.locator(`[aria-labelledby="${id}"]`);
    await snap(page, f('send-alert-03-parts'), [
      { target: card('alert-what') },
      { target: card('alert-who') },
      { target: card('alert-until') },
      { target: card('alert-preview') },
      {
        target: page
          .getByText(tr('attention', 'composer.sentTitle'), { exact: true })
          .first()
          .locator('xpath=ancestor::*[contains(@class,"rounded")][1]'),
      },
    ]);
  });
});
