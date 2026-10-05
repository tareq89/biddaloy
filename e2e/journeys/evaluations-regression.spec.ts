import {
  adminApiSession,
  closeSurvey,
  completeAcr,
  createAcr,
  createClassSection,
  createIncident,
  createSurvey,
  createTeacher,
  createTeacherForSection,
  currentAcademicYearId,
  get,
  parentApiSession,
  patch,
  post,
  publishSurvey,
  type ApiSession,
  type FreshTeacher,
} from '../api';
import { expectNoAxeViolations } from '../a11y/assert';
import { acrBody, incidentBody, surveyBody } from '../fixtures/evaluations';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [28.4.10] Epic 28 regression: ONE chain across ACR -> incident -> survey ->
 * Performance, then a programmatic screen-reader check (roles, names, live
 * regions) of the ACR form, the survey answer screen and a Performance tab.
 *
 * The role/name assertions are the automated stand-in for a screen-reader
 * pass. They do NOT replace one: a human with NVDA/VoiceOver/TalkBack still has
 * to listen to these screens.
 *
 * Serial: each step reads what the previous one created. The shared ACR form
 * version is never edited here (other specs rely on its criteria count).
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now();
const surveyTitle = `Regression survey ${stamp}`;
const state: {
  admin?: ApiSession;
  staff?: FreshTeacher;
  incomplete?: { userId: string; acrId: string };
  surveyId?: string;
  yearId?: string;
} = {};

test.describe('admin builds the chain', () => {
  test.use(loggedIn('admin'));

  test('ACR completed, incident reported, survey opened, Performance rolls it up', async ({
    page,
    request,
  }) => {
    const admin = (state.admin = await adminApiSession(request));
    const parent = await parentApiSession(request);
    const yearId = (state.yearId = await currentAcademicYearId(request, admin));

    // --- ACR: score every criterion of the CURRENT form version, complete. ---
    const chain = await createClassSection(request, admin);
    const staff = (state.staff = await createTeacherForSection(
      request,
      admin,
      `Regression Staff ${stamp}`,
      chain.sectionId,
    ));
    const { criteria } = await get<{ criteria: { id: string }[] }>(request, admin, '/acr/criteria');
    expect(criteria.length).toBeGreaterThan(0);
    const acr = await createAcr(request, admin, acrBody(staff.userId, yearId));
    await patch(request, admin, `/acr/assessments/${acr.id}`, {
      scores: criteria.map((c) => ({ criterion_id: c.id, score: 4 })),
    });
    expect((await completeAcr(request, admin, acr.id)).total).toBe(criteria.length * 4);

    // A second, INCOMPLETE ACR for the form accessibility step below.
    const other = await createTeacher(request, admin, `Regression ACR Form ${stamp}`);
    const open = await createAcr(request, admin, acrBody(other.userId, yearId));
    state.incomplete = { userId: other.userId, acrId: open.id };

    // --- incident ---
    await createIncident(request, admin, incidentBody(staff.userId));

    // --- survey: guardian-eligible pair, opened (answered in a later step) ---
    const kids = await get<{ id: string; class_section_id: string }[]>(
      request,
      parent,
      '/students/mine',
    );
    const child = await get<{ class_section: { class_id: string } }>(
      request,
      admin,
      `/students/${kids[0]!.id}`,
    );
    const subject = await post<{ id: string }>(request, admin, '/subjects', {
      code: `RG-${stamp.toString(36).toUpperCase()}`,
      name_en: `Regression Subject ${stamp}`,
      name_bn: 'রিগ্রেশন বিষয়',
    });
    await post(
      request,
      admin,
      `/classes/${child.class_section.class_id}/sections/${kids[0]!.class_section_id}/teachers`,
      { teacher_id: staff.teacherId, subject_id: subject.id },
    );
    const survey = await createSurvey(
      request,
      admin,
      surveyBody(surveyTitle, staff.teacherId, subject.id, { respondent: 'GUARDIANS' }),
    );
    state.surveyId = survey.id;
    expect((await publishSurvey(request, admin, survey.id)).status).toBe('OPEN');

    // --- Performance API: ACR in, incident counted, survey sealed (still OPEN). ---
    const perf = await get<{
      acr: { status: string; total: number }[];
      incidentCount: number;
      survey: { averageStars: number | null };
    }>(request, admin, `/performance/staff/${staff.userId}?academicYearId=${yearId}`);
    expect(perf.acr.some((a) => a.status === 'COMPLETED' && a.total === criteria.length * 4)).toBe(
      true,
    );
    expect(perf.incidentCount).toBe(1);
    expect(perf.survey.averageStars).toBeNull();

    // --- Performance tab: the same facts, and its accessibility tree. ---
    await page.goto(`/staff/${staff.userId}?tab=performance`);
    const tab = page.getByRole('tab', { name: t('performance.title'), exact: true });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tablist')).toBeVisible();
    const panel = page.getByRole('tabpanel', { name: t('performance.title'), exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(t('performance.surveyWaiting'))).toBeVisible();
    await expect(
      panel.getByText(t('evaluations.acr.status.COMPLETED'), { exact: false }).first(),
    ).toBeVisible();
    await expect(panel.getByRole('heading').first()).toBeVisible();
    await expectNoAxeViolations(page, '[role="tabpanel"]');
  });
});

test.describe('ACR form accessibility', () => {
  test.use(loggedIn('admin'));

  test('criteria are named groups of toggle buttons, with a polite live region', async ({
    page,
  }) => {
    const { userId, acrId } = state.incomplete!;
    await page.goto(`/staff/${userId}/acr/${acrId}`);
    await page.getByRole('button', { name: t('common.wizard.next'), exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#acr-keyboard-hint')).toBeVisible();

    const group = page
      .getByRole('group')
      .filter({ has: page.getByRole('button', { pressed: false }) });
    await expect(group.first()).toBeVisible();
    // Every group has an accessible name and 4 buttons exposing aria-pressed.
    const first = group.first();
    await expect(first).toHaveAccessibleName(/.+/);
    await expect(first.getByRole('button', { pressed: false })).toHaveCount(4);
    await first.getByRole('button').first().click();
    await expect(first.getByRole('button', { pressed: true })).toHaveCount(1);
    // Live regions: status line(s) announce progress.
    expect(await page.locator('[role="status"], [aria-live="polite"]').count()).toBeGreaterThan(0);
    await expectNoAxeViolations(page, 'main');
  });
});

test.describe('guardian answers', () => {
  test.use(loggedIn('parent'));

  test('survey answer screen: labelled fields, rating group, 1-5 keys, alert on empty', async ({
    page,
  }) => {
    await page.goto('/portal/surveys');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: surveyTitle })).toBeVisible();
    await page.getByText(`Regression Staff ${stamp}`).first().click();

    const form = page.locator('details', { hasText: `Regression Staff ${stamp}` }).locator('form');
    const rating = form.getByRole('group').first();
    await expect(rating).toHaveAccessibleName(/.+/);
    await expect(rating.getByRole('button')).toHaveCount(5);
    for (const button of await rating.getByRole('button').all()) {
      await expect(button).toHaveAccessibleName(/.+/);
    }
    // Every textarea has a label (screen readers read the question).
    for (const box of await form.getByRole('textbox').all()) {
      await expect(box).toHaveAccessibleName(/.+/);
    }
    // Keys 1-5 set the rating from inside the group.
    await rating.getByRole('button').first().focus();
    await page.keyboard.press('4');
    await expect(rating.getByRole('button', { pressed: true })).toHaveCount(1);
    await page.keyboard.press('Backspace');
    await expect(rating.getByRole('button', { pressed: true })).toHaveCount(0);
    // Submitting nothing announces an alert instead of failing silently.
    await form.getByRole('button', { name: t('evaluations.portalSurveys.submit') }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    // Then really answer.
    await rating.getByRole('button').nth(3).click();
    await form.getByRole('button', { name: t('evaluations.portalSurveys.submit') }).click();
    await expect(page.getByText(t('evaluations.portalSurveys.sent'))).toBeVisible();
  });
});

test.describe('admin closes', () => {
  test.use(loggedIn('admin'));

  test('closed with one answer: results and the Performance average stay sealed', async ({
    page,
    request,
  }) => {
    const admin = state.admin!;
    await closeSurvey(request, admin, state.surveyId!);
    const { results } = await get<{ results: { hidden: boolean; count: number }[] }>(
      request,
      admin,
      `/surveys/${state.surveyId}/results`,
    );
    expect(results.every((r) => r.hidden)).toBe(true);
    expect(results[0]!.count).toBe(1);
    const perf = await get<{ survey: { averageStars: number | null } }>(
      request,
      admin,
      `/performance/staff/${state.staff!.userId}?academicYearId=${state.yearId}`,
    );
    expect(perf.survey.averageStars).toBeNull();

    await page.goto(`/staff/evaluations/surveys/${state.surveyId}`);
    await expect(page.getByRole('status').filter({ hasText: /[1১]/ }).first()).toBeVisible();
  });
});
