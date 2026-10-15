import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { expectFocusRing, resetTabCursor, tabToLocator } from './keyboard-utils';

/**
 * [8.10.7.6.04] The parent's `/portal` overview, keyboard only (no `page.mouse`, no `.click(`, no
 * `waitForTimeout`): skip link, a Tab walk through the today strip and the cards with a focus ring
 * at every stop, the heatmap child picker (when the family has two children), and the homework
 * card's "all homework" link. Data: `seed.dashboard.ts` `seedFamilyFacts`.
 *
 * Product fact: the child picker is a group of `aria-pressed` buttons in the Tab order, not a
 * roving-tabindex toolbar, so Arrow keys do nothing; the journey switches child with Enter/Space.
 */

test.use(loggedIn('parent'));

test('portal overview: skip link, Tab walk, child picker, homework link', async ({ page }) => {
  await page.goto('/portal');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');

  await test.step('first Tab is the skip link; Enter moves focus to main', async () => {
    await resetTabCursor(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t('nav.skipToContent') })).toBeFocused();
    await expectFocusRing(page);
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  await test.step('Tab through the strip and the cards: every stop is a visible control, no trap', async () => {
    const main = page.locator('#main-content');
    const seen = new Set<number>();
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      await expectFocusRing(page);
      const inMain = await main.evaluate((m) => m.contains(document.activeElement));
      if (!inMain) break; // walked past the content into the bottom bar: no trap
      // Position in the document, so two cards with identical markup still count as two stops.
      const stop = await page.evaluate(() =>
        Array.from(document.querySelectorAll('*')).indexOf(document.activeElement!),
      );
      expect(seen.has(stop), `Tab press ${i + 1} landed on a control already visited`).toBe(false);
      seen.add(stop);
    }
    // Every Tab press moved on to a new control.
    expect(seen.size).toBeGreaterThan(2);
  });

  await test.step('heatmap child picker switches child with Enter / Space', async () => {
    await resetTabCursor(page);
    const picker = page
      .getByRole('group', { name: t('portal.heatmap.childPicker') })
      .getByRole('button');
    if ((await picker.count()) < 2) {
      test.info().annotations.push({
        type: 'not-exercised',
        description: 'the seeded parent has one child, so the heatmap shows no child picker',
      });
      return;
    }
    const second = picker.nth(1);
    await tabToLocator(page, second, 60);
    await expect(second).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-pressed', 'true');
    await expect(second).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Space');
    await expect(picker.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(picker.nth(0)).toBeFocused();
  });

  await test.step('the homework card link opens /portal/homework with focus on the h1', async () => {
    await resetTabCursor(page);
    const link = page.getByRole('link', { name: t('portal.homeworkCard.link') }).first();
    await tabToLocator(page, link, 80);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/portal\/homework/);
    const h1 = page.getByRole('heading', { level: 1, name: t('portal.homework.title') });
    await expect(h1).toBeVisible();
    await expect(h1).toBeFocused();
  });
});
