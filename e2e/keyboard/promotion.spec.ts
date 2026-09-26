import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import { adminApiSession, createClassSection, ensureGradingScale, patch, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ApprovalModalPage } from '../pages';

/**
 * [26.8.1] Promotion, KEYBOARD ONLY: palette → new-run form → grid
 * override → commit. No `page.mouse` and no `.click(` reaches the new-run
 * form or the grid — same split as `analysis.spec.ts`, the commit
 * dialog's own Confirm button and `ApprovalModalPage` are the one
 * precedented exception every file in this folder already takes
 * (`grading-scales.spec.ts`'s header comment: no keyboard-only precedent
 * for the shared step-up modal, so this reuses `ApprovalModalPage` as-is).
 *
 * Route: a fresh source class with two passing students and one published
 * exam (`/results/process` + `/results/publish`, same as
 * `analysis.spec.ts`), plus an explicit target year/class/section created
 * directly via the API — the form lets the target class be picked by hand
 * regardless of what `useSuggestPromotionTarget` suggests, so this doesn't
 * depend on that algorithm's matching rules.
 *
 * This is a DRAFT-then-COMMITTED run on a class this spec alone created —
 * never the shared seed's already-committed fixture (D17 plan note).
 *
 * `promotions.promote`'s palette label isn't in an i18n catalog — it's a
 * literal `{ en, bn }` map inside `action-registry.ts` itself (there's no
 * `promotions` namespace for it to live in). The bn string below is that
 * literal, not a translated lookup.
 */
const PROMOTE_STUDENTS_ACTION_BN = 'শিক্ষার্থী উত্তরণ করুন';

test.use(loggedIn('admin'));

test('keyboard-only: palette to new run, fill the form, R-override a row, commit, see the badge', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const session = await adminApiSession(request);
  const source = await createClassSection(request, session);
  await ensureGradingScale(request, session, source.academicYearId);

  const targetYearName = `E2E Target Year ${Date.now()}`;
  const targetYear = await post<{ id: string }>(request, session, '/academic-years', {
    name: targetYearName,
    start_date: '2099-01-01',
    end_date: '2099-12-31',
  });
  const targetClass = await post<{ id: string }>(request, session, '/classes', {
    name: `${source.className} Target`,
    academic_year_id: targetYear.id,
    numeric_grade: 7,
  });
  await post(request, session, `/classes/${targetClass.id}/sections`, { section_name: 'A' });
  // The R-override below retains a student, and commit places them in the
  // target year's class with the source's `numeric_grade` (D20) — so the
  // source needs a grade and the target year needs that same-grade class.
  await patch(request, session, `/classes/${source.classId}`, { numeric_grade: 6 });
  const retainClass = await post<{ id: string }>(request, session, '/classes', {
    name: `${source.className} Retain`,
    academic_year_id: targetYear.id,
    numeric_grade: 6,
  });
  await post(request, session, `/classes/${retainClass.id}/sections`, { section_name: 'A' });

  const student1 = await post<{ id: string; full_name: string }>(request, session, '/students', {
    full_name: `E2E Promo A ${Date.now()}`,
    class_section_id: source.sectionId,
  });
  await post(request, session, '/students', {
    full_name: `E2E Promo B ${Date.now()}`,
    class_section_id: source.sectionId,
  });

  const subject = await post<{ id: string }>(request, session, '/subjects', {
    code: `E2EPR-${Date.now().toString(36).toUpperCase()}`,
    name_en: 'E2E Promotion Subject',
    name_bn: 'ই২ই উত্তরণ বিষয়',
  });
  // Results only count subjects assigned to the class. Without this both
  // students total 0, tie on merit, and the first grid row isn't student1.
  await post(request, session, `/classes/${source.classId}/subjects`, {
    subject_id: subject.id,
    academic_year_id: source.academicYearId,
  });
  const examName = `E2E Promotion Exam ${Date.now()}`;
  const exam = await post<{ id: string }>(request, session, '/exams', {
    name: examName,
    kind: ExamKind.TERM,
    academic_year_id: source.academicYearId,
    class_id: source.classId,
  });
  const component = await post<{ id: string }>(request, session, `/exams/${exam.id}/components`, {
    subject_id: subject.id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100.00',
    pass_marks: '33.00',
    sequence: 1,
  });

  const marksResponse = await request.patch(`/api/v1/exams/${exam.id}/marks`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    data: {
      section_id: source.sectionId,
      subject_id: subject.id,
      cells: [
        { student_id: student1.id, component_id: component.id, value: '80.00', status: 'PRESENT' },
      ],
    },
  });
  if (!marksResponse.ok()) {
    throw new Error(`PATCH marks failed: ${marksResponse.status()} ${await marksResponse.text()}`);
  }
  await post(request, session, `/exams/${exam.id}/marks/submit`, {
    section_id: source.sectionId,
    subject_id: subject.id,
  });
  await post(request, session, `/exams/${exam.id}/results/process`, {});
  await post(request, session, `/exams/${exam.id}/results/publish`, {});

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('open the new-run form through the Ctrl+K palette', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
    await expect(input).toBeFocused();

    await page.keyboard.press('Control+3');
    await expect(
      page.getByRole('tab', { name: t('nav.commandPalette.tabs.action') }),
    ).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.type(PROMOTE_STUDENTS_ACTION_BN);
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/promotions\/new$/);
  });

  // Each control is reached with `.focus()` and driven with real keys,
  // not by counting Tab presses from wherever the palette left focus —
  // `command-palette.spec.ts` documents why a Tab count through the
  // sidebar is too environment-dependent to assert on. Pickers go through
  // `selectByTypeahead` with this run's own unique names.
  await test.step('fill the new-run form mouse-free', async () => {
    await expect(page.getByRole('dialog')).toBeHidden();
    // `useRouteFocus` focuses the new page's <h1> once the navigation and
    // its view transition settle — the signal that the form is ready.
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();

    // `selectByTypeahead`'s flow, but the option may carry a " (<year>)"
    // suffix: the form adds it only when that year is on the first page of
    // `GET /academic-years`, which other specs' new years can push it off.
    async function pick(label: string, value: string) {
      const picker = page.getByRole('combobox', { name: label });
      await expect(picker).toBeEnabled();
      await picker.focus();
      await page.keyboard.press('Enter');
      await page.keyboard.type(value);
      const option = page.getByRole('option', { name: new RegExp(`^${value}( \\(.*\\))?$`) });
      await expect(option).toBeVisible();
      await option.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('listbox')).toBeHidden();
    }
    await pick(t('promotions.newRunForm.sourceClassLabel'), source.className);
    await pick(t('promotions.newRunForm.targetYearLabel'), targetYearName);
    await pick(t('promotions.newRunForm.targetClassLabel'), `${source.className} Target`);

    await page.getByRole('button', { name: t('promotions.newRunForm.create') }).focus();
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/promotions\/[^/]+$/);
  });

  await test.step('R on the first row, note, Ctrl+Enter opens the commit dialog', async () => {
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await page.getByLabel(t('promotions.grid.columnFinal')).first().focus();
    await page.keyboard.press('r');
    // `setOutcome` moves focus to that row's note input on the next frame —
    // no extra Tab needed, but wait for it: keys typed before then land on
    // the outcome cell, where `r` in the note text is itself a shortcut.
    await expect(page.getByLabel(t('promotions.grid.columnOverrideNote')).first()).toBeFocused();
    await page.keyboard.type('E2E keyboard override note');
    await page.keyboard.press('ControlOrMeta+Enter');

    await expect(
      page.getByRole('heading', { name: t('promotions.grid.commitConfirm.title') }),
    ).toBeVisible();
  });

  await test.step('complete the approval modal, confirm', async () => {
    const [commitResponse] = await Promise.all([
      page.waitForResponse(
        async (response) => {
          if (response.request().method() !== 'POST') return false;
          if (!/\/promotions\/[^/]+\/commit$/.test(response.url())) return false;
          return (await response.request().headerValue('X-Approval-Token')) !== null;
        },
        // `ApprovalModalPage` may wait out the 65 s OTP cooldown when another
        // spec just used the same approver.
        { timeout: 90_000 },
      ),
      (async () => {
        await page
          .getByRole('button', { name: t('promotions.grid.commitConfirm.confirm') })
          .click();
        await new ApprovalModalPage(page).complete('admin@biddaloy.test');
      })(),
    ]);
    expect(commitResponse.ok(), await commitResponse.text()).toBe(true);

    await expect(
      page.getByRole('heading', { name: t('promotions.grid.commitConfirm.title') }),
    ).toBeHidden();
    // The class name also appears in the target/retain class names, so
    // pin the run's own heading.
    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(`^${source.className} → `) }),
    ).toBeVisible();
  });

  await test.step('the overridden student carries the override badge', async () => {
    await page.goto(`/students/${student1.id}`);
    await expect(page.getByRole('heading', { level: 1, name: student1.full_name })).toBeVisible();
    await expect(page.getByText('E2E keyboard override note', { exact: false })).toBeVisible();
  });
});
