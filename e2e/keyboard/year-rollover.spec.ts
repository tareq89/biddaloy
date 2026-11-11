import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [69.4.99] "Create next year", KEYBOARD ONLY: Ctrl+K palette action, then the wizard's two
 * steps by Enter. No `page.mouse` and no `.click(` anywhere.
 *
 * ```mermaid
 * flowchart LR
 *   A[Ctrl+K, Actions tab] --> B["type: Create next year"]
 *   B --> C["/academic-years?next=1"]
 *   C --> D["current year's /next wizard"]
 *   D --> E[Enter: Next] --> F[preview tiles shown]
 * ```
 *
 * The run stops on the preview step on purpose: pressing Create would add a real next year to
 * the shared seed's current year, which every other spec reads. `year-rollover.spec.ts`
 * creates for real, on a year of its own. The palette label is a literal `{ en, bn }` map in
 * `action-registry.ts` (no i18n namespace), so the bn string below is that literal.
 */
const CREATE_NEXT_ACTION_BN = 'পরের বছর বানাও';

test.use(loggedIn('admin'));

test('keyboard-only: palette to the wizard, Enter to the preview step', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('open the wizard through the Ctrl+K palette', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+3');
    await expect(
      page.getByRole('tab', { name: t('nav.commandPalette.tabs.action') }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.type(CREATE_NEXT_ACTION_BN);
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    // The list page resolves the current year and goes on to its wizard.
    await expect(page).toHaveURL(/\/academic-years\/[^/]+\/next$/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('academicYears.nextYear.title') }),
    ).toBeVisible();
  });

  await test.step('Enter on the name step goes to the preview', async () => {
    // Focus starts on the name field (prefilled); Enter in a plain input advances.
    await page.locator('#next-year-name').focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('checkbox', { name: t('academicYears.nextYear.blocks.classes'), exact: true }),
    ).toBeChecked();
    await expect(
      page.getByRole('button', { name: t('academicYears.nextYear.create') }),
    ).toBeVisible();
  });
});
