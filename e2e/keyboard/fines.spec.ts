import {
  adminApiSession,
  createClassSection,
  createFineStructure,
  get,
  logFine,
  parentApiSession,
  post,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ApprovalModalPage } from '../pages';

import { selectByTypeahead, tabUntilFocused } from './keyboard-utils';

/**
 * [38.5.1] Keyboard-only journeys, one per new Epic 38.0 screen:
 *  (a) `/fees/fines` — nav to the page, `l` opens Log fine, log one,
 *      then Waive it through the shared step-up modal (`ApprovalModalPage`
 *      as-is, mouse-free everywhere else — same call `promotion.spec.ts`
 *      and `grading-scales.spec.ts` already make for this exact modal,
 *      documented there as having no keyboard-only precedent of its own).
 *  (b) `/fees/fines/rules` — tab to the Rules link, `n` opens the create
 *      form, save an ABSENT rule.
 *  (c) A student's Fines tab: its own inline "Log fine" button (not the
 *      command palette — see the note below) opens `LogFineModal` with
 *      the student pre-selected via `prefillStudentIds`.
 *  (d) The guardian portal's "Due this month" card lists a logged fine
 *      with its reason.
 *
 * Plan correction on (c): the ticket describes this as "Ctrl+K `>log
 * fine` with the student prefilled". `fees/fines/index.tsx`'s own header
 * comment documents that the command palette's `fines.log` action
 * (`action-registry.ts`) can only `navigate({ to: '/fees/fines?logFine=1' })`
 * — no entity id crosses that boundary (`ActionRunContext`'s documented
 * limitation, flagged in the PR body for #1119/#1122, not fixed there).
 * Going through the palette here would open the *unprefilled* modal, which
 * doesn't exercise "student prefilled" at all. The student detail's Fines
 * tab (`students/-detail/fines-tab.tsx`) has its own "Log fine" button
 * that opens the same `LogFineModal` with `prefillStudentIds={[studentId]}`
 * — that's the one place "prefilled" is real, so this test reaches the
 * modal through that button, keyboard-only, instead.
 */

test.describe('(a) Fines list: nav -> l -> log a fine -> Enter -> Waive -> step-up -> WAIVED', () => {
  test.use(loggedIn('admin'));

  test('keyboard-only: log a fine from the Fines list, then waive it', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const chain = await createClassSection(request, session);
    const studentName = `E2E Kbd Fines Student ${Date.now()}`;
    await post(request, session, '/students', {
      full_name: studentName,
      class_section_id: chain.sectionId,
    });
    const fineName = `E2E Kbd Fine ${Date.now()}`;
    await createFineStructure(request, session, chain, fineName, 75);

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    await test.step('nav -> Fines, keyboard only', async () => {
      await page.evaluate(() => {
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });
      await page.keyboard.press('Tab');
      await tabUntilFocused(page, t('nav.items.fines'), 60, { tag: 'a' });
      await page.keyboard.press('Enter');
    });

    await expect(page).toHaveURL(/\/fees\/fines$/);

    const logDialog = page.getByRole('dialog', { name: t('fines.logForm.title') });

    await test.step('"l" opens Log fine', async () => {
      await page.keyboard.press('l');
      await expect(logDialog).toBeVisible();
    });

    await test.step('pick the student, fee, note, save', async () => {
      const searchInput = logDialog.getByLabel(t('fines.logForm.studentsLabel'));
      await searchInput.fill(studentName);
      const resultButton = logDialog.getByRole('button', { name: studentName });
      await expect(resultButton).toBeVisible();
      // The result list is a plain `<li><button>`, not a combobox listbox —
      // no arrow-key roving tabindex to ride, so Tab from the search input
      // (the button is the very next focusable element in DOM order) then
      // Enter, same "focus + Enter fires the onClick" pattern this whole
      // file uses instead of `.click()`.
      await page.keyboard.press('Tab');
      await expect(resultButton).toBeFocused();
      await page.keyboard.press('Enter');

      const feePicker = logDialog.getByLabel(t('fines.logForm.feeLabel'));
      await feePicker.focus();
      await selectByTypeahead(page, fineName);

      await logDialog.getByLabel(t('fines.logForm.noteLabel')).fill('Keyboard-only e2e fine');

      // `logForm.save`'s label is the literal same string as `logForm.title`
      // (both "জরিমানা যোগ করুন") — the still-mounted "Log fine" trigger
      // button behind the overlay would otherwise strict-mode-collide with
      // this, so the query stays scoped to `logDialog`.
      const saveButton = logDialog.getByRole('button', { name: t('fines.logForm.save') });
      await saveButton.focus();
      await page.keyboard.press('Enter');
    });

    await test.step('the row appears', async () => {
      await expect(logDialog).toBeHidden();
      await expect(page.getByText(fineName)).toBeVisible();
    });

    await test.step('Enter reaches Waive, step-up, WAIVED', async () => {
      const waiveButton = page.getByRole('button', { name: t('fines.waiveDialog.confirm') });
      await waiveButton.focus();
      await page.keyboard.press('Enter');

      const dialog = page.getByRole('dialog', { name: t('fines.waiveDialog.title') });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(t('fines.waiveDialog.reasonLabel')).fill('Keyboard-only waive');

      const confirmButton = dialog.getByRole('button', { name: t('fines.waiveDialog.confirm') });
      await confirmButton.focus();
      await page.keyboard.press('Enter');

      // Step-up: same shared modal `promotion.spec.ts`/`grading-scales.spec.ts`
      // reuse as-is inside an otherwise keyboard-only spec — no keyboard-only
      // precedent for it exists yet (see those files' own header comments).
      await new ApprovalModalPage(page).complete('admin@biddaloy.test');

      await expect(page.getByText(t('common.status.fee.WAIVED'))).toBeVisible();
    });
  });
});

test.describe('(b) Rules: tab -> n -> create an ABSENT rule -> save', () => {
  test.use(loggedIn('admin'));

  test('keyboard-only: create an ABSENT fine rule from the Rules tab', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const chain = await createClassSection(request, session);
    const fineName = `E2E Kbd Rule Fine ${Date.now()}`;
    await createFineStructure(request, session, chain, fineName, 100);

    await page.goto('/fees/fines');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    await test.step('tab to the Rules link, Enter', async () => {
      await page.evaluate(() => {
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });
      await page.keyboard.press('Tab');
      await tabUntilFocused(page, t('fines.tabs.rules'), 60, { tag: 'a' });
      await page.keyboard.press('Enter');
    });

    await expect(page).toHaveURL(/\/fees\/fines\/rules$/);

    await test.step('"n" opens the create-rule dialog', async () => {
      await page.keyboard.press('n');
      await expect(
        page.getByRole('dialog', { name: t('fees.fines.rules.form.createTitle') }),
      ).toBeVisible();
    });

    await test.step('pick the fee type (trigger defaults to ABSENT), save', async () => {
      const feePicker = page.getByLabel(t('fees.fines.rules.form.feeStructureLabel'));
      await feePicker.focus();
      await selectByTypeahead(page, fineName);

      const saveButton = page.getByRole('button', { name: t('fees.fines.rules.form.save') });
      await saveButton.focus();
      await page.keyboard.press('Enter');
    });

    await test.step('the new rule appears in the list', async () => {
      await expect(
        page.getByRole('dialog', { name: t('fees.fines.rules.form.createTitle') }),
      ).toBeHidden();
      await expect(page.getByText(fineName, { exact: false })).toBeVisible();
    });
  });
});

test.describe('(c) Student > Fines tab: the tab\'s own "Log fine" button, student prefilled', () => {
  test.use(loggedIn('admin'));

  test("keyboard-only: log fine from a student's Fines tab, with the student pre-selected", async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const chain = await createClassSection(request, session);
    const studentName = `E2E Kbd Fines Tab Student ${Date.now()}`;
    const student = await post<{ id: string }>(request, session, '/students', {
      full_name: studentName,
      class_section_id: chain.sectionId,
    });
    const fineName = `E2E Kbd Tab Fine ${Date.now()}`;
    await createFineStructure(request, session, chain, fineName, 60);

    await page.goto(`/students/${student.id}?tab=fines`);
    await expect(page.getByRole('heading', { level: 1, name: studentName })).toBeVisible();

    await test.step('tab to the Fines tab\'s own "Log fine" button, Enter', async () => {
      await page.evaluate(() => {
        document.body.setAttribute('tabindex', '-1');
        document.body.focus();
        document.body.removeAttribute('tabindex');
      });
      await page.keyboard.press('Tab');
      await tabUntilFocused(page, t('fines.logForm.title'), 120, { tag: 'BUTTON' });
      await page.keyboard.press('Enter');
    });

    const dialog = page.getByRole('dialog', { name: t('fines.logForm.title') });
    await expect(dialog).toBeVisible();

    await test.step('the student is already the one selected chip', async () => {
      // `prefillStudentIds` seeds the chip with an empty name until
      // `LogFineModal`'s own `useQueries` resolves it — wait for the real
      // name rather than asserting on the raw id.
      await expect(dialog.getByText(studentName)).toBeVisible();
    });

    await test.step('pick the fee, note, save', async () => {
      const feePicker = dialog.getByLabel(t('fines.logForm.feeLabel'));
      await feePicker.focus();
      await selectByTypeahead(page, fineName);

      await dialog
        .getByLabel(t('fines.logForm.noteLabel'))
        .fill('Keyboard-only, prefilled student');

      const saveButton = dialog.getByRole('button', { name: t('fines.logForm.save') });
      await saveButton.focus();
      await page.keyboard.press('Enter');
    });

    await test.step("the fine lands on the student's Fines tab", async () => {
      await expect(dialog).toBeHidden();
      await expect(page.getByText(fineName)).toBeVisible();
    });
  });
});

test.describe('(d) Portal: "Due this month" lists the fine with its reason', () => {
  test.use(loggedIn('parent'));

  test('the guardian\'s "Due this month" card shows a logged fine and its reason', async ({
    page,
    request,
  }) => {
    const adminSession = await adminApiSession(request);
    // Fresh login independent of this test's own (parent) browser storage
    // state — see `parentApiSession`'s own doc comment. Resolves the
    // seeded parent's real `Guardian` id, the same account this test's
    // own `/portal` page is signed in as, so the student created below is
    // actually visible from that portal session. `createGuardian` alone
    // would make an unrelated `Guardian` row with no login of its own.
    const parentSession = await parentApiSession(request);
    const guardian = await get<{ id: string }>(request, parentSession, '/guardians/mine');
    const chain = await createClassSection(request, adminSession);
    const reason = `E2E portal fine reason ${Date.now()}`;
    const fineName = `E2E Portal Fine ${Date.now()}`;
    const student = await post<{ id: string }>(request, adminSession, '/students', {
      full_name: `E2E Portal Fine Student ${Date.now()}`,
      class_section_id: chain.sectionId,
      guardian_ids: [guardian.id],
    });
    const fineStructure = await createFineStructure(request, adminSession, chain, fineName, 40);
    await logFine(request, adminSession, {
      student_ids: [student.id],
      fee_structure_id: fineStructure.id,
      note: reason,
      incident_date: new Date().toISOString().slice(0, 10),
      notify_families: false,
    });

    await page.goto('/portal');
    await expect(page.getByText(t('portal.fees.dueThisMonth')).first()).toBeVisible();
    await expect(page.getByText(fineName)).toBeVisible();
    await expect(page.getByText(reason)).toBeVisible();
  });
});
