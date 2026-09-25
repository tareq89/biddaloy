import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import { adminApiSession, createClassSection, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ApprovalModalPage } from '../pages';
import { tabUntilFocused } from './keyboard-utils';

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

  const targetYear = await post<{ id: string }>(request, session, '/academic-years', {
    name: `E2E Target Year ${Date.now()}`,
    start_date: '2099-01-01',
    end_date: '2099-12-31',
  });
  const targetClass = await post<{ id: string }>(request, session, '/classes', {
    name: `${source.className} Target`,
    academic_year_id: targetYear.id,
  });
  await post(request, session, `/classes/${targetClass.id}/sections`, { section_name: 'A' });

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

  await test.step('fill the new-run form mouse-free', async () => {
    await tabUntilFocused(page, t('promotions.newRunForm.sourceClassLabel'), 30, {
      tag: 'BUTTON',
    });
    await page.keyboard.press('Enter');
    await page.keyboard.type(source.className);
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('promotions.newRunForm.targetYearLabel'), 15, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    await page.keyboard.type('E2E Target Year');
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('promotions.newRunForm.targetClassLabel'), 15, {
      tag: 'BUTTON',
    });
    await page.keyboard.press('Enter');
    await page.keyboard.type(`${source.className} Target`);
    await page.keyboard.press('Enter');

    await tabUntilFocused(page, t('promotions.newRunForm.create'), 30, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/promotions\/[^/]+$/);
  });

  await test.step('R on the first row, note, Ctrl+Enter opens the commit dialog', async () => {
    await tabUntilFocused(page, t('promotions.outcome.promote'), 30, { tag: 'DIV' });
    await page.keyboard.press('r');
    // `setOutcome` moves focus to that row's note input the moment the
    // outcome becomes an override — no extra Tab needed.
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
        { timeout: 30_000 },
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
    await expect(page.getByText(source.className, { exact: false })).toBeVisible();
  });

  await test.step('the overridden student carries the override badge', async () => {
    await page.goto(`/students/${student1.id}`);
    await expect(page.getByRole('heading', { level: 1, name: student1.full_name })).toBeVisible();
    await expect(page.getByText('E2E keyboard override note', { exact: false })).toBeVisible();
  });
});
