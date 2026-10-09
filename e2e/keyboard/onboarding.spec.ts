import { uniqueRegistration, E2E_PASSWORD } from '../api';
import { expect, guest, test } from '../fixtures/test';
import { t } from '../i18n';
import { WelcomePage } from '../pages';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [13.7.1] Onboarding, KEYBOARD ONLY. No `page.mouse` and no `.click(` call in
 * this file: register, choose a setup door with the arrow keys and Enter, and
 * reach the staff import from the people step.
 */
test.use({ ...guest, actionTimeout: 15_000 });

/** Tab to the field named `label`, then type into it. */
async function typeInto(page: import('@playwright/test').Page, label: string, value: string) {
  await tabUntilFocused(page, label, 15);
  await page.keyboard.type(value);
}

test('register, pick a door with the arrow keys, reach the staff import', async ({ page }) => {
  test.setTimeout(90_000);
  const who = uniqueRegistration();

  await test.step('register by keyboard', async () => {
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: t('register.title') })).toBeVisible();
    await typeInto(page, t('register.fields.adminName'), who.adminName);
    await typeInto(page, t('register.fields.schoolName'), who.schoolName);
    await typeInto(page, t('register.fields.address'), '1 Test Road, Dhaka');
    await typeInto(page, t('register.fields.phone'), who.phone);
    await typeInto(page, t('register.fields.email'), who.email);
    await tabUntilFocused(page, t('register.terms'), 5);
    await page.keyboard.press('Space');
    await tabUntilFocused(page, t('register.continue'), 5, { tag: 'BUTTON' });
    const started = page.waitForResponse((res) => res.url().includes('/auth/register/start'));
    await page.keyboard.press('Enter');
    const otp = ((await (await started).json()) as { debug: { otp: string } }).debug.otp;

    // The code field takes focus by itself.
    await expect(page.getByLabel(t('register.otp.title'))).toBeFocused();
    await page.keyboard.type(otp);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: t('register.password.title') })).toBeVisible();
    await typeInto(page, t('auth.setPassword.label'), E2E_PASSWORD);
    await typeInto(page, t('auth.setPassword.confirmLabel'), E2E_PASSWORD);
    await page.keyboard.press('Enter');
  });

  const welcome = new WelcomePage(page);
  await test.step('the three doors: arrows move, Enter takes the chosen one', async () => {
    await welcome.expectLoaded();
    await tabUntilFocused(page, t('onboardingSetup.doors.guided.title'), 15, { tag: 'BUTTON' });
    await page.keyboard.press('ArrowDown');
    await expect(welcome.door('excel')).toBeChecked();
    await expect(welcome.door('excel')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(welcome.door('later')).toBeChecked();
    await page.keyboard.press('Enter');
  });

  await test.step('the people step: Tab to the staff file and open it', async () => {
    await expect(page.getByRole('heading', { name: t('onboardingPeople.heading') })).toBeVisible();
    // Each card has its own "Upload Excel file" link; the staff card is the second.
    const uploads = page.getByRole('link', { name: t('onboardingPeople.uploadExcel') });
    await tabUntilFocused(page, t('onboardingPeople.uploadExcel'), 15);
    await tabUntilFocused(page, t('onboardingPeople.uploadExcel'), 15);
    await expect(uploads.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/staff\/import/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('staffImport.title') }),
    ).toBeVisible();
  });
});
