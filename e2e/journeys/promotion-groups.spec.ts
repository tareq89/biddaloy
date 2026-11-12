import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import type { APIRequestContext, Browser } from '@playwright/test';
import {
  adminApiSession,
  createClassSection,
  currentAcademicYear,
  createTeacher,
  ensureGradingScale,
  get,
  loginAsFreshUser,
  patch,
  post,
  submitMarkSheet,
  type ApiSession,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead } from '../keyboard/keyboard-utils';

/**
 * [69.5.02] Groups page, end to end (T3): the class teacher of a section opens
 * `/promotions/$runId/groups`, filters by one subject's marks, selects everything that
 * matches, sets "Science" and applies; the admin then sees the group on the run page. A teacher
 * whose homeroom is another section cannot see the run (404).
 *
 * Setup is API-only: a fresh section with two students (maths 80 and 50), a published exam, a
 * draft run into a target class whose section uses groups. "Science" is in the seed vocabulary;
 * it is added when a run of the suite finds it missing.
 *
 * The My class "Groups pending" card is fed by the attention engine, which no spec can trigger
 * (the FAST sweep runs every 5 minutes). The test opens the card when it shows up within 20 s and
 * otherwise goes to the page by URL, and says so in an annotation.
 */
const GROUP = 'Science';

async function ensureGroup(request: APIRequestContext, admin: ApiSession) {
  const path = `/schools/${admin.tenantId}/settings`;
  const s = await get<{ version: number; organisation?: { groups?: string[] } }>(
    request,
    admin,
    path,
  );
  const groups = s.organisation?.groups ?? [];
  if (groups.includes(GROUP)) return;
  await patch(request, admin, path, {
    version: s.version,
    organisation: { ...s.organisation, groups: [...groups, GROUP] },
  });
}

async function teacherPage(
  browser: Browser,
  baseURL: string,
  who: { email: string; password: string },
) {
  const api = await (await import('@playwright/test')).request.newContext({ baseURL });
  const storageState = await loginAsFreshUser(api, baseURL, who.email, who.password);
  await api.dispose();
  const context = await browser.newContext({ storageState, baseURL });
  return { context, page: await context.newPage() };
}

test.use(loggedIn('admin'));

test('class teacher sets groups in bulk from a marks filter; admin sees them; another homeroom is refused', async ({
  page,
  request,
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const url = baseURL ?? '';
  const suffix = crypto.randomUUID().slice(0, 8);
  const admin = await adminApiSession(request);
  await ensureGroup(request, admin);

  // A homeroom list only covers the CURRENT academic year, so the class goes in that one.
  const currentYear = await currentAcademicYear(request, admin);
  const source = await createClassSection(request, admin, currentYear);
  // Class-specific override: the current year already has a default scale (a second default 409s).
  await ensureGradingScale(request, admin, source.academicYearId, source.classId);
  await patch(request, admin, `/classes/${source.classId}`, { numeric_grade: 6 });
  const targetYear = await post<{ id: string }>(request, admin, '/academic-years', {
    name: `E2E PG Year ${suffix}`,
    start_date: '2099-01-01',
    end_date: '2099-12-31',
  });
  const targetClass = await post<{ id: string }>(request, admin, '/classes', {
    name: `${source.className} Target`,
    academic_year_id: targetYear.id,
    numeric_grade: 7,
  });
  // A target section with a group is what makes the run "use groups" (attention rule, D15).
  await post(request, admin, `/classes/${targetClass.id}/sections`, {
    section_name: 'A',
    group_name: GROUP,
  });

  const high = await post<{ id: string }>(request, admin, '/students', {
    full_name: `E2E PG High ${suffix}`,
    class_section_id: source.sectionId,
  });
  const low = await post<{ id: string }>(request, admin, '/students', {
    full_name: `E2E PG Low ${suffix}`,
    class_section_id: source.sectionId,
  });
  const subjectCode = `E2EPG-${suffix.toUpperCase()}`;
  const subject = await post<{ id: string }>(request, admin, '/subjects', {
    code: subjectCode,
    name_en: 'E2E Groups Maths',
    name_bn: 'ই২ই গ্রুপ গণিত',
  });
  await post(request, admin, `/classes/${source.classId}/subjects`, {
    subject_id: subject.id,
    academic_year_id: source.academicYearId,
  });
  const exam = await post<{ id: string }>(request, admin, '/exams', {
    name: `E2E PG Exam ${suffix}`,
    kind: ExamKind.TERM,
    academic_year_id: source.academicYearId,
    class_id: source.classId,
  });
  const component = await post<{ id: string }>(request, admin, `/exams/${exam.id}/components`, {
    subject_id: subject.id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100.00',
    pass_marks: '33.00',
    sequence: 1,
  });
  await patch(request, admin, `/exams/${exam.id}/marks`, {
    section_id: source.sectionId,
    subject_id: subject.id,
    cells: [
      { student_id: high.id, component_id: component.id, value: '80.00', status: 'PRESENT' },
      { student_id: low.id, component_id: component.id, value: '50.00', status: 'PRESENT' },
    ],
  });
  await submitMarkSheet(request, admin, exam.id, {
    section_id: source.sectionId,
    subject_id: subject.id,
  });
  await post(request, admin, `/exams/${exam.id}/results/process`, {});
  await post(request, admin, `/exams/${exam.id}/results/publish`, {});
  const run = await post<{ id: string }>(request, admin, '/promotions', {
    source_class_id: source.classId,
    target_academic_year_id: targetYear.id,
    exam_ids: [exam.id],
    algorithm: 'BLOCK',
  });

  const classTeacher = await createTeacher(request, admin, `E2E PG Teacher ${suffix}`, source);
  const otherSection = await createClassSection(request, admin, currentYear);
  const otherTeacher = await createTeacher(request, admin, `E2E PG Other ${suffix}`, otherSection);

  const mine = await teacherPage(browser, url, classTeacher);
  try {
    const tp = mine.page;
    await test.step('My class: open the groups page (card when the sweep has run)', async () => {
      await tp.goto(`/my-class/${source.sectionId}`);
      const card = tp.getByRole('link', { name: t('myClass.groupsPendingAction') });
      const shown = await card
        .waitFor({ timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (shown) await card.click();
      else {
        test.info().annotations.push({
          type: 'card-skipped',
          description: 'attention sweep had not raised the item within 20 s',
        });
        await tp.goto(`/promotions/${run.id}/groups`);
      }
      await expect(tp).toHaveURL(new RegExp(`/promotions/${run.id}/groups$`));
      await expect(tp.getByText(`E2E PG High ${suffix}`)).toBeVisible();
      await expect(tp.getByText(`E2E PG Low ${suffix}`)).toBeVisible();
    });

    await test.step('filter maths >= 60, select all matching, Science, apply', async () => {
      await tp.getByRole('combobox', { name: t('promotions.groups.filters.subject') }).focus();
      await selectByTypeahead(tp, subjectCode);
      await tp.getByLabel(t('promotions.groups.filters.marksMin')).fill('60');
      await expect(tp.getByText(`E2E PG Low ${suffix}`)).toBeHidden();
      await expect(tp.getByText(`E2E PG High ${suffix}`)).toBeVisible();

      await tp
        .getByRole('button', {
          name: t('promotions.groups.selectAllMatching', { n: 1 }),
          exact: true,
        })
        .click();
      await tp.getByRole('combobox', { name: t('promotions.groups.groupLabel') }).click();
      await tp.getByRole('option', { name: GROUP, exact: true }).click();
      await tp
        .getByRole('button', {
          name: t('promotions.groups.apply', { n: 1 }),
          exact: true,
        })
        .click();
      await expect(
        // The toast renders an outer role="status" wrapper and an inner
        // <span role="status"> with the text; name the inner one only.
        tp.getByText(t('promotions.groups.applied', { n: 1 }), { exact: true }),
      ).toBeVisible();
    });
  } finally {
    await mine.context.close();
  }

  await test.step('admin sees the group on the run page; the low scorer has none', async () => {
    const detail = await get<{
      entries: { student_id: string; group_name: string | null }[];
    }>(request, admin, `/promotions/${run.id}`);
    expect(detail.entries.find((e) => e.student_id === high.id)?.group_name).toBe(GROUP);
    expect(detail.entries.find((e) => e.student_id === low.id)?.group_name).toBeNull();
    await page.goto(`/promotions/${run.id}`);
    await expect(
      page
        .getByRole('row')
        .filter({ hasText: `E2E PG High ${suffix}` })
        .getByRole('combobox', { name: t('promotions.grid.columnGroup') }),
    ).toContainText(GROUP);
  });

  await test.step('a teacher of another homeroom cannot read this run', async () => {
    const other = await teacherPage(browser, url, otherTeacher);
    try {
      await other.page.goto(`/promotions/${run.id}/groups`);
      await expect(other.page.getByText(`E2E PG High ${suffix}`)).toHaveCount(0);
      await expect(other.page.getByText(t('promotions.groups.loadError'))).toBeVisible();
    } finally {
      await other.context.close();
    }
  });
});
