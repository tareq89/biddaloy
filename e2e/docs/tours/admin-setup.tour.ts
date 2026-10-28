/**
 * [Epic 42] Media for the admin "Create your school" and "Setup order" guide pages
 * (`admin.createSchool`, `admin.setupOrder`): the setup wizard's three doors, and the
 * dashboard checklist card a fresh school keeps after "Do this later".
 *
 * A fresh school comes from `newSchool` (registered over the API, like a stranger would),
 * so this tour never touches the shared demo school. Run it against the docs
 * environment database only; registering creates a new school.
 * The register form itself (details, code, password) is not shot here: it needs
 * a real SMS code, so those images stay "image pending" on the page.
 */
import { expect, test } from '@playwright/test';

import bnSetup from '../../../ui/src/i18n/locales/bn/onboardingSetup.json';
import bnChecklist from '../../../ui/src/i18n/locales/bn/setupChecklist.json';
import enSetup from '../../../ui/src/i18n/locales/en/onboardingSetup.json';
import enChecklist from '../../../ui/src/i18n/locales/en/setupChecklist.json';
import { newSchool } from '../../fixtures/new-school';
import { guideLang, imgDir, prepare, shoot } from '../helpers/capture';

const lang = guideLang();
const setup = lang === 'bn' ? bnSetup : enSetup;
const checklist = lang === 'bn' ? bnChecklist : enChecklist;
const dir = imgDir('admin');

test('desktop: wizard doors, then the dashboard checklist', async ({
  browser,
  playwright,
}, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  const school = await newSchool(browser, playwright);
  try {
    const { page } = school;
    await prepare(page);
    await page.goto('/welcome');
    const heading = page.getByRole('heading', { name: setup.doors.heading });
    await expect(heading).toBeVisible();
    await shoot(page, `${dir}/create-school-03-wizard-doors.png`, [
      { target: page.getByRole('radio', { name: setup.doors.guided.title }) },
      { target: page.getByRole('radio', { name: setup.doors.later.title }) },
    ]);

    await page.getByRole('button', { name: setup.footer.later }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const card = page.getByRole('heading', { name: checklist.title });
    await expect(card).toBeVisible();
    await shoot(page, `${dir}/setup-00-checklist.png`, [{ target: card }]);
  } finally {
    await school.api.dispose();
    await school.context.close();
  }
});
