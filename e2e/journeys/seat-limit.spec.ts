import bnBilling from '../../ui/src/i18n/locales/bn/billing.json' with { type: 'json' };

import { createClassSection, post, setSeatLimit } from '../api';
import { newSchool } from '../fixtures/new-school';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { FormShellPage } from '../pages/form-shell';

/**
 * [13.7.1] A school with a 10-seat limit holds 10 students (set directly: new schools are
 * unlimited during the free period, Epic 49).
 * Ten go in over the API; the 11th, added in the UI, is refused with the
 * translated "limit reached" message. Own school: the seeded trial one is shared.
 */
test.use({ actionTimeout: 15_000 });

test('the 11th student of a trial school shows the limit message', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const school = await newSchool(browser, playwright);
  try {
    const { page, api, session } = school;
    await setSeatLimit(session.tenantId, 10);
    // This year, not `createClassSection`'s fixed default: the new school has no
    // other year, and the pickers below must keep finding this class after 2026.
    const year = new Date().getFullYear();
    const chain = await createClassSection(api, session, {
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    });
    for (let n = 1; n <= 10; n++) {
      await post(api, session, '/students', {
        full_name: `Seat Student ${n}`,
        class_section_id: chain.sectionId,
      });
    }

    const form = new FormShellPage(page);
    await page.goto('/students/new');
    // Not `form.fillField`: its exact match misses the "(required)" suffix on the label.
    await page.getByLabel(t('students.form.fields.fullName')).fill('Seat Student 11');
    await page.getByLabel(t('students.form.fields.class')).click();
    await page.getByRole('option').first().click();
    await page.getByLabel(t('students.form.fields.section')).click();
    await page.getByRole('option').first().click();
    await form.submit('students.new.submitAction');

    await expect(page.getByText(t('trial.seatLimit.title'))).toBeVisible();
    // An ADMIN can buy seats, so "Buy seats" replaces the "contact us" hint (#1825).
    await expect(page.getByRole('button', { name: bnBilling.buy.action })).toBeVisible();
  } finally {
    await school.context.close();
    await school.api.dispose();
  }
});
