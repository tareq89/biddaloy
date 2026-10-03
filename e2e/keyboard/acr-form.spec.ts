import { adminApiSession, createTeacher, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [28.3.7] Keyboard-only ACR: Ctrl+K "Start ACR" -> pick staff -> Ctrl+Enter
 * starts it -> step through to Criteria -> 4/3/2/1 scores (D21) -> Ctrl+Enter
 * completes. Criteria count is read from the API: other specs may have saved
 * a smaller form version, so nothing here hard-codes 25.
 */

test.use(loggedIn('admin'));

test('keyboard-only: start an ACR from the palette, score every criterion, complete', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const name = `E2E Kbd ACR ${Date.now()}`;
  await createTeacher(request, session, name);
  const { criteria } = await get<{ criteria: unknown[] }>(request, session, '/acr/criteria');

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('Ctrl+K, Action tab, run "Start ACR"', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3');
    await page.keyboard.type(t('evaluations.palette.startAcr'));
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: t('evaluations.acr.startTitle') })).toBeVisible();
  });

  await test.step('pick the staff member, Ctrl+Enter starts the ACR', async () => {
    await tabUntilFocused(page, t('evaluations.acr.staffLabel'), 10);
    await selectByTypeahead(page, name);
    await page.keyboard.press('Control+Enter');
    await expect(page).toHaveURL(/\/staff\/[^/]+\/acr\/[^/]+$/);
  });

  await test.step('Next to Criteria, score every criterion with digit keys', async () => {
    // The sidebar sits ahead of the wizard in tab order (60+ stops), so focus the
    // button directly; activation is still a real key press.
    await page.getByRole('button', { name: t('wizard.next'), exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#acr-keyboard-hint')).toBeVisible();
    // Blur whatever the step change focused so digits reach the document handler.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < criteria.length; i += 1) {
      await page.keyboard.press(String(4 - (i % 3)));
    }
    await expect(page.getByText(t('evaluations.acr.step2.unscored'))).toHaveCount(0);
  });

  await test.step('Ctrl+Enter completes; the ACR becomes read-only', async () => {
    await page.keyboard.press('Control+Enter');
    await expect(page.getByText(t('evaluations.acr.completedReadOnly'))).toBeVisible();
  });
});
