import { adminApiSession, createClassSection, createWalkInApplicant, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { selectByTypeahead } from './keyboard-utils';

/**
 * [71.0 / #4203] Keyboard-only journeys for the admission desk. Every interaction goes through
 * `page.keyboard`; `locator.focus()` only places the cursor (same as `command-palette.spec.ts`).
 *
 * A: Ctrl+K -> "New application" -> clerk entry form -> Ctrl+Enter, then the applicant is read
 *    back over the API. The round requires no document and ticks only the five core boxes: the
 *    PHOTO box is a native file input, which a keyboard cannot fill without the OS picker (the
 *    sibling `marks-import.spec.ts` uses `setInputFiles` for that; a plain-field journey needs none).
 * B: stage marks grid -> type marks, Enter moves down, `A` marks absent, Tab to Save, Enter. The
 *    saved results are read back from `GET /admission/stages/:id/results`.
 */

test.use(loggedIn('admin'));

const API_DATES = { open_date: '2020-01-01', close_date: '2099-12-31' };

test('keyboard-only: palette to clerk entry, fill every box, Ctrl+Enter saves the application', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const stamp = Date.now();
  const title = `E2E Kbd Clerk ${stamp}`;
  const name = `Kbd Clerk Child ${stamp}`;
  const phone = `01712${String(stamp).slice(-6)}`;

  const section = await createClassSection(request, admin);
  const intake = await post<{ id: string }>(request, admin, '/admission-intakes', {
    title,
    class_section_id: section.sectionId,
    seat_count: 10,
    ...API_DATES,
    required_document_types: [],
    form_fields: ['name', 'dob', 'gender', 'guardian_name', 'guardian_phone'],
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('Ctrl+K, Action tab, run "New application"', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
    await page.keyboard.press('Control+3');
    // The label lives in `action-registry.ts`, not a catalog; Bangla is the e2e default.
    await page.keyboard.type('নতুন আবেদন তুলুন');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admissions\/applicants\/new$/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('admission-desk.clerk.title') }),
    ).toBeVisible();
  });

  await test.step('pick the round by keyboard', async () => {
    await page.locator('#clerk-round').focus();
    await selectByTypeahead(page, title);
    await expect(page.locator('#clerk-name')).toBeVisible();
  });

  await test.step('fill the boxes by keyboard', async () => {
    await page.locator('#clerk-name').focus();
    await page.keyboard.type(name);
    // Date input segments follow the browser locale (en-US: month, day, year).
    await page.locator('#clerk-dob').focus();
    await page.keyboard.type('06012018');
    await expect(page.locator('#clerk-dob')).toHaveValue('2018-06-01');
    await page.locator('#clerk-gender').focus();
    await selectByTypeahead(page, t('admission-desk.clerk.options.MALE'));
    await page.locator('#clerk-guardian_name').focus();
    await page.keyboard.type(`Guardian of ${name}`);
    await page.locator('#clerk-guardian_phone').focus();
    await page.keyboard.type(phone);
  });

  await test.step('Ctrl+Enter saves; the confirmation shows', async () => {
    const saved = page.waitForResponse(
      (r) => r.url().includes('/admission/applicants') && r.request().method() === 'POST',
    );
    await page.keyboard.press('Control+Enter');
    expect((await saved).ok()).toBe(true);
  });

  await test.step('the applicant exists (API read-back)', async () => {
    const listed = await get<{ applicant_name: string }[] | { data: { applicant_name: string }[] }>(
      request,
      admin,
      `/admission/applicants?intakeId=${intake.id}`,
    );
    const rows = Array.isArray(listed) ? listed : listed.data;
    expect(rows.map((r) => r.applicant_name)).toContain(name);
  });
});

test('keyboard-only: stage marks grid, type marks, Enter moves down, A = absent, save by Tab+Enter', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const stamp = Date.now();

  const section = await createClassSection(request, admin);
  // No fee: applicants start PENDING, so they are eligible for rolls and marks straight away.
  const intake = await post<{ id: string }>(request, admin, '/admission-intakes', {
    title: `E2E Kbd Marks ${stamp}`,
    class_section_id: section.sectionId,
    seat_count: 10,
    ...API_DATES,
    required_document_types: ['PHOTO'],
  });
  const stage = await post<{ id: string }>(
    request,
    admin,
    `/admission-intakes/${intake.id}/stages`,
    {
      kind: 'WRITTEN',
      title: 'Written test',
      config: { total_marks: 100 },
    },
  );

  const names = ['A', 'B', 'C'].map((s) => `Kbd Marks ${s} ${stamp}`);
  for (const [i, applicant] of names.entries()) {
    await createWalkInApplicant(request, admin, {
      intakeId: intake.id,
      name: applicant,
      guardianPhone: `01712${String(stamp + i).slice(-6)}`,
    });
  }
  // Applied-at order = creation order, so the grid rows run A, B, C.
  await post(request, admin, `/admission/intakes/${intake.id}/rolls`, { order: 'APPLIED_AT' });

  await page.goto(`/admissions/rounds/${intake.id}?step=${stage.id}`);
  const cell = (n: string) =>
    page.getByRole('textbox', { name: new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });

  await test.step('type 80, Enter, A (absent), type 65', async () => {
    await cell(names[0]).focus();
    await expect(cell(names[0])).toBeFocused();
    await page.keyboard.type('80');
    await page.keyboard.press('Enter');
    await expect(cell(names[1])).toBeFocused();
    await page.keyboard.press('A');
    await expect(cell(names[1])).toBeDisabled();
    await expect(cell(names[2])).toBeFocused();
    await page.keyboard.type('65');
    await expect(cell(names[2])).toHaveValue(/^(65|৬৫)$/);
  });

  await test.step('Tab past the Absent box to Save, Enter', async () => {
    await page.keyboard.press('Tab'); // C's Absent checkbox
    await page.keyboard.press('Tab'); // Save marks
    await expect(page.getByRole('button', { name: t('admission-stages.grid.save') })).toBeFocused();
    const put = page.waitForResponse(
      (r) =>
        r.url().includes(`/admission/stages/${stage.id}/results`) && r.request().method() === 'PUT',
    );
    await page.keyboard.press('Enter');
    expect((await put).ok()).toBe(true);
  });

  await test.step('saved results match (API read-back)', async () => {
    const res = await get<{
      data: { name: string; attended: boolean; score: number | null }[];
    }>(request, admin, `/admission/stages/${stage.id}/results`);
    const byName = new Map(res.data.map((r) => [r.name, r]));
    expect(byName.get(names[0])).toMatchObject({ attended: true, score: 80 });
    expect(byName.get(names[1])).toMatchObject({ attended: false, score: null });
    expect(byName.get(names[2])).toMatchObject({ attended: true, score: 65 });
  });
});
