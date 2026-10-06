import { starterWorkbook, uniqueRegistration } from '../api';
import { newSchool } from '../fixtures/new-school';
import { starterRows } from '../fixtures/onboarding-files';
import { expect, guest, test } from '../fixtures/test';
import { t } from '../i18n';
import { RegisterPage, WelcomePage } from '../pages';

/**
 * [13.7.1] A stranger registers and sets up a school, end to end.
 *
 * Pack data (`server/src/modules/presets/packs/bd/nctb`): the English name is
 * what the confirm dialog wants typed; the Bangla names are what the default
 * (bn) UI renders — same constants as `keyboard/curriculum-preset.spec.ts`.
 */
const NCTB_NAME_EN = 'Bangladesh NCTB curriculum';
const NCTB_NAME_BN = 'বাংলাদেশ এনসিটিবি পাঠ্যক্রম';
const NCTB_STAGES_BN = ['প্রাথমিক', 'নিম্ন মাধ্যমিক', 'মাধ্যমিক', 'উচ্চ মাধ্যমিক'];
const NCTB_VERSION_BANGLA_BN = 'বাংলা';

test.describe('register and set up a school', () => {
  test.setTimeout(180_000);

  test.describe('the guided door', () => {
    test.use(guest);

    test('register, set a password, answer the questions, add people, land on the dashboard', async ({
      page,
    }) => {
      const who = uniqueRegistration();
      const register = new RegisterPage(page);
      const welcome = new WelcomePage(page);

      await test.step('register: details, code, password with the checklist turning green', async () => {
        await register.goto();
        const otp = await register.submitDetails({ ...who, address: '1 Test Road, Dhaka' });
        await register.submitCode(otp);
        await register.setPassword('Strong-Pass-1');
        await welcome.expectLoaded();
      });

      await test.step('guided door: school name', async () => {
        await expect(welcome.door('guided')).toBeChecked();
        await welcome.next();
        await expect(
          page.getByRole('heading', { name: t('onboardingSetup.guided.profile.title') }),
        ).toBeVisible();
        await expect(page.getByLabel(t('onboardingSetup.guided.profile.nameEn'))).toHaveValue(
          who.schoolName,
        );
        await welcome.next();
      });

      await test.step('guided door: curriculum (skipped here, see the fixme below), sections', async () => {
        await expect(
          page.getByRole('heading', { name: t('onboardingSetup.guided.curriculum.title') }),
        ).toBeVisible();
        await page
          .getByRole('button', { name: t('onboardingSetup.guided.curriculum.skip') })
          .click();
        await expect(
          page.getByRole('heading', { name: t('onboardingSetup.guided.sections.title') }),
        ).toBeVisible();
        // No classes yet, so nothing to create: "Next" moves on.
        await welcome.next();
      });

      await test.step('people step, then the summary', async () => {
        await expect(
          page.getByRole('heading', { name: t('onboardingPeople.heading') }),
        ).toBeVisible();
        await welcome.next();
        await expect(
          page.getByRole('heading', { name: t('onboardingPeople.summary.title') }),
        ).toBeVisible();
        await page.getByRole('button', { name: t('onboardingSetup.footer.finish') }).click();
      });

      await test.step('dashboard shows the trial bar and the checklist', async () => {
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.getByRole('button', { name: t('trial.details.open') })).toBeVisible();
        await expect(page.getByRole('heading', { name: t('setupChecklist.title') })).toBeVisible();
      });
    });
  });

  test('the guided door applies a curriculum preset', async ({ browser, playwright }) => {
    // App bug: inside /welcome the confirm dialog's field never takes focus or
    // text (the Radix focus trap of FullPageShell wins), so "Apply" stays disabled.
    test.fixme(true, 'ConfirmApplyDialog field cannot be typed into inside the /welcome wizard');
    const school = await newSchool(browser, playwright);
    try {
      const { page } = school;
      const welcome = new WelcomePage(page);
      await page.goto('/welcome?step=setup&path=guided&q=2');
      await page
        .getByRole('group', { name: NCTB_NAME_BN })
        .getByRole('button', { name: t('curriculumPreset.cards.select') })
        .click();
      const next = page.getByRole('button', { name: t('common.wizard.next') });
      await next.click();
      for (const stage of NCTB_STAGES_BN.slice(1)) {
        await page.getByRole('checkbox', { name: stage, exact: true }).uncheck();
      }
      await page.getByRole('checkbox', { name: NCTB_VERSION_BANGLA_BN, exact: true }).check();
      await next.click();
      await page.getByRole('button', { name: t('curriculumPreset.submit') }).click();
      const typed = page.getByRole('textbox', {
        name: t('curriculumPreset.confirm.typeLabel', { name: NCTB_NAME_EN }),
      });
      await typed.click();
      await page.keyboard.type(NCTB_NAME_EN);
      await page.getByRole('button', { name: t('curriculumPreset.confirm.apply') }).click();
      await expect(
        page.getByRole('heading', { name: t('curriculumPreset.applied.title') }),
      ).toBeVisible();
      await welcome.next();
      await expect(
        page.getByRole('heading', { name: t('onboardingSetup.guided.sections.title') }),
      ).toBeVisible();
    } finally {
      await school.context.close();
      await school.api.dispose();
    }
  });

  test('the Excel door: a file with a problem first, then the clean one', async ({
    browser,
    playwright,
  }) => {
    const school = await newSchool(browser, playwright);
    try {
      const { page } = school;
      const welcome = new WelcomePage(page);
      const file = (buffer: Buffer) => ({
        name: 'starter.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer,
      });
      const bad = await starterWorkbook(school.api, school.session, starterRows(true));
      const good = await starterWorkbook(school.api, school.session, starterRows());

      await page.goto('/welcome');
      await welcome.expectLoaded();
      await welcome.door('excel').click();
      await welcome.next();
      await expect(
        page.getByRole('heading', { name: t('onboardingSetup.excel.title') }),
      ).toBeVisible();

      await page.getByLabel(t('bulkImport.chooseFile')).setInputFiles(file(bad));
      await expect(
        page.getByText(t('onboardingSetup.excel.errorsFound_one', { count: 1 })),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByRole('button', { name: t('onboardingSetup.excel.confirm') }),
      ).toBeDisabled();

      await page.getByRole('button', { name: t('bulkImport.uploadAnother') }).click();
      await page.getByLabel(t('bulkImport.chooseFile')).setInputFiles(file(good));
      await expect(
        page.getByRole('heading', { name: t('onboardingSetup.excel.preview') }),
      ).toBeVisible({
        timeout: 30_000,
      });
      await page.getByRole('button', { name: t('onboardingSetup.excel.confirm') }).click();
      await expect(page.getByText(t('onboardingSetup.excel.done'))).toBeVisible({
        timeout: 60_000,
      });
    } finally {
      await school.context.close();
      await school.api.dispose();
    }
  });
});
