import type { Page } from '@playwright/test';

import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [22.4.1] Keyboard-only journey: Ctrl+K -> Action tab -> "Assign homework"
 * -> create+assign form -> save. Clones `command-palette.spec.ts`'s
 * Ctrl+3-jumps-to-Action-tab pattern. No mouse calls anywhere in this file.
 */

/** Opens a focused Radix `Select` trigger and picks `value` by typeahead —
 * same helper `organisation-structure.spec.ts`/`syllabus.spec.ts` use.
 * Picking by unique name rather than "ArrowDown, Enter" matters here: the
 * class/subject pickers list every class/subject in the shared e2e
 * database, so a positional pick lands on whichever row another run left
 * behind, not on data this test created. */
async function selectByTypeahead(page: Page, value: string): Promise<void> {
  await page.keyboard.press('Enter');
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
}

test.use(loggedIn('admin'));

test('Ctrl+K -> Assign homework action -> create+assign form -> save, mouse-free', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const { classId, className, academicYearId } = await createClassSection(request, session);
  const suffix = `${Date.now()}`;
  const subjectName = `E2E Homework Subject ${suffix}`;
  const subject = await post<{ id: string }>(request, session, '/subjects', {
    name_en: subjectName,
    code: `E2EHW${suffix}`.slice(0, 20),
  });
  await post(request, session, `/classes/${classId}/subjects`, {
    subject_id: subject.id,
    academic_year_id: academicYearId,
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();

  await test.step('Ctrl+3 switches to the Action tab', async () => {
    await page.keyboard.press('Control+3');
    await expect(
      page.getByRole('tab', { name: t('nav.commandPalette.tabs.action') }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  // The action registry's label is a hardcoded `{ en, bn }` pair, not
  // routed through the app's `t()` catalogs (see `action-registry.ts`'s
  // `homework.assign` entry) — search by the bn text since bn is this
  // suite's default locale.
  const assignActionLabel = 'বাড়ির কাজ দিন';

  await test.step('query "Assign homework" action, Enter runs it', async () => {
    await page.keyboard.type(assignActionLabel);
    await expect(page.getByRole('option', { name: assignActionLabel })).toBeVisible();
    await page.keyboard.press('Enter');
  });

  await test.step('landed on the create+assign form', async () => {
    await expect(page).toHaveURL(/\/academics\/homework\/new$/);
    await expect(page.getByRole('heading', { name: t('homework.form.createTitle') })).toBeVisible();
  });

  await test.step('fill required fields and save, keyboard only', async () => {
    // Tab through the form's pickers/inputs in DOM order and type/select
    // values without ever calling a mouse method. Field labels come from
    // the same `-assign-homework-form.tsx` this test targets.
    await page.getByLabel(t('homework.form.titleLabel')).fill('Kbd Homework Assign');
    await page.keyboard.press('Tab');

    // Class/subject pickers: `@biddaloy/ui` comboboxes, keyboard-operable
    // like the palette's own combobox. Pick by this test's own unique,
    // timestamped names rather than "ArrowDown, Enter" — the pickers list
    // every class/subject in the shared e2e database, so a positional pick
    // lands on whichever row another run left behind, which may have no
    // subjects/sections at all (same fix `syllabus.spec.ts` already needed).
    const classPicker = page.getByLabel(t('homework.form.classLabel'));
    await classPicker.focus();
    await selectByTypeahead(page, className);

    const subjectPicker = page.getByLabel(t('homework.form.subjectLabel'));
    await subjectPicker.focus();
    await selectByTypeahead(page, subjectName);

    // Exact match: the target RadioGroup's section item carries its own
    // aria-label "<targetLabel>: <sectionLabel>" (a valid a11y pattern —
    // it describes what picking this radio does), which contains
    // sectionLabel as a substring and would otherwise also match here.
    const sectionPicker = page.getByLabel(t('homework.form.sectionLabel'), { exact: true });
    await sectionPicker.focus();
    // `createClassSection` always names its one section "A".
    await selectByTypeahead(page, 'A');

    await page.getByRole('button', { name: t('homework.form.submit') }).focus();
    await page.keyboard.press('Enter');
  });

  await test.step('assigned and landed on the homework detail', async () => {
    await expect(page).toHaveURL(/\/academics\/homework\/[^/]+$/);
  });
});
